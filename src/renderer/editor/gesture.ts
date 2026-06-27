/**
 * K3.5 段階1: 破壊ジェスチャの即時取り消し線（gesture プラグイン）。
 *
 * 由来: `spikes/k35-spike/src/gesture2.ts`（U1/U6 を runtime 実証した単一 tr 置換方式）を
 *   app へ移植。スパイクの素朴版が抱えていた BLOCKER（取り消し線済み区間の再削除で原文が
 *   消える＝条件①）を classifyDeleted の no-op で塞いだ版。U5 記法文字ガードは段階2 の責務
 *   ゆえ本ファイルに持ち込まない（段階1 は消す系ジェスチャの即時取り消し線だけ）。
 *
 * 機構（plan6 §0-1）:
 *   Backspace/Delete/選択上書きを handleKeyDown/handleTextInput で握りつぶし、同じユーザー操作を
 *   **単一 tr** として dispatch し直す:
 *     - base/highlight 由来の削除 → その区間に criticDeletion を addMark（doc は縮まない＝原文は消えない）
 *     - insertion（自分の追記）/comment 本文 由来の削除 → 本当に delete（追記は消える）
 *     - 既に criticDeletion の区間への削除系 → **何もしない（no-op）**（条件①・原文を二重に触らない）
 *     - 選択上書き（削除＋タイプ）→ 削除側は addMark/drop・タイプ文字は削除区間の右端へ挿入
 *   この単一 tr が undo 履歴の1単位＝Ctrl+Z で「直前に付けた取り消し線が外れる」（U1）。
 *
 * fold との関係（plan6 §0-4・触らない範囲）:
 *   gesture の置換 tr（addMark deletion 等）は fold-bracket の編集検出に乗り、foldEdit が
 *   workingMd を `{--…--}` に折り込む（K3 の T4 削除マーク FOLD_IN と同経路）。foldin/fold-bracket は
 *   一切触らない。
 *
 * 設計判断（実測で直したら理由を追記する）:
 *   - 検出対象 = 「人が起こした・削除を含む」入力。除外メタ AKAPEN_GESTURE_META を自分の tr に付け、
 *     insertion-on-type が二重マークしないよう役割排他する（条件④）。
 *   - 削除区間は handleKeyDown 時点の state.doc（削除前 doc）で分類する。
 *   - IME 変換中（view.composing）は介入しない＝確定後の tr で処理（既存 plugin と同窓）。
 *   - 段落結合（ブロック頭 Backspace / ブロック末 Delete）は握らない＝既存 fold の C1 ガードに委ねて
 *     原文の段落構造を守る（段階4 で `{--\n\n--}` 即時化を被せるまでは安全側）。
 */
import type { Mark, MarkType, Node as PMNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { Transaction } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { deletionSchema, insertionSchema } from "./critic";

/** gesture の置換 tr に付ける印（insertion-on-type の除外用＝条件④）。 */
export const AKAPEN_GESTURE_META = "akapen-gesture";

// ===== K3.5 段階2: U5 記法文字ガード =====

/**
 * U5: critic 記法の開き/閉じデリミタ8種。これらが doc に素入力で入ると
 * markup トークン境界が壊れ A2reject が黙って崩れる（escape 構文なし）。
 * 入口で弾いて知らせる（noisy＝黙って壊さない）。
 * vitest の import 対象として export する。
 */
export const CRITIC_DELIMITERS = [
  "{--",
  "--}",
  "{++",
  "++}",
  "{>>",
  "<<}",
  "{==",
  "==}",
] as const;

/**
 * デリミタの部分形成（1〜2文字目まで）。8種デリミタの prefix/suffix。
 * ⚠️ 段階2 の handleTextInput/handlePaste では使っていない（formsCriticDelimiter は
 * 完成形 hasCriticDelimiter で判定する＝段階1 K3-6c のように「完成1文字目の `=` で弾く」
 * ロジック）。将来 typeahead-suppression（部分形成も弾く）等の段階で使う可能性のため残置。
 * 独立レビュー（typescript-reviewer・2026-06-13）の指摘で誤 entry '>}' を削除した
 *   （8種デリミタの prefix/suffix のどれにも該当しないため・comment 閉じは '<<}' 経由の '<}'）。
 */
export const CRITIC_PARTIALS = [
  "{-",
  "-}",
  "{+",
  "+}",
  "{>",
  "<<",
  "<}",
  "{=",
  "=}",
] as const;

/**
 * text が critic デリミタ8種のいずれかを含むか。
 * ペーストの全文検査・逐次タイプの局所文字列検査どちらにも使う。
 * vitest でユニットテストする。
 */
export function hasCriticDelimiter(text: string): boolean {
  return CRITIC_DELIMITERS.some((d) => text.includes(d));
}

/**
 * text がデリミタの部分片（CRITIC_PARTIALS）で終わるか、またはデリミタ完成形を含むか。
 * 逐次タイプの境界形成判定で使う。
 * vitest でユニットテストする。
 */
export function endsWithCriticPartial(text: string): boolean {
  return (
    CRITIC_PARTIALS.some((d) => text.endsWith(d)) || hasCriticDelimiter(text)
  );
}

/**
 * U5: from..to を text で置換したとき、挿入境界の前後3文字＋text を合わせた局所文字列に
 * critic デリミタ（完成形）が生じるか。逐次タイプ（`+` `+` `}` を1字ずつ打って
 * `++}` が完成する瞬間）も弾く（spike U5a 実証済み）。
 * vitest でユニットテストする（EditorView を要するため e2e でカバーする部分も含む）。
 */
export function formsCriticDelimiter(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const { doc } = view.state;
  const before = doc.textBetween(Math.max(0, from - 3), from, "\n", "\n");
  const after = doc.textBetween(
    to,
    Math.min(doc.content.size, to + 3),
    "\n",
    "\n",
  );
  const local = before + text + after;
  return hasCriticDelimiter(local);
}

/** U5 hook 定義（段階2 追加・段階1 互換維持のため省略可） */
export interface GestureHooks {
  /** critic デリミタ入力を弾いた時に呼ぶ（検出されたデリミタ文字列を渡す） */
  onNotationBlocked?: (text: string) => void;
  /**
   * K3.5 段階4（plan9）: 段落結合即時化（ブロック頭 Backspace / ブロック末 Delete）。
   *
   * gesture は PM doc を変えない（DOC-INVARIANT 維持＝plan9 §6 D1）。代わりに app 側で
   * workingMd 上の対応する `\n\n` を `{--\n\n--}` で囲む文字列編集を行う。app 側の実装は
   * 「workingMd オフセットを foldin/pmVisible+rawVisible 経由で特定→state.workingMd 直接編集
   *   →onEdited()/refreshOutline() を起こす」を期待する。
   *
   * 引数 direction:
   *   - 'backspace': ブロック頭で発火（前ブロック末の `\n\n` を取り消し線化）
   *   - 'delete':    ブロック末で発火（次ブロック頭の `\n\n` を取り消し線化）
   *
   * 戻り値（呼び出し側＝gesture が分岐する）:
   *   - 'joined':  workingMd を編集して取り消し線化した（metrics.paragraphJoins++）
   *   - 'noop':    対応する `\n\n` が既に `{--\n\n--}` で囲まれている（条件①同型＝
   *                 metrics.noops++・workingMd は触らない・PM 既定挙動も抑止）
   *   - 'reject':  写像不能 or 境界条件外（gesture は true を返して既定挙動を抑止する＝
   *                 PM の段落結合動作が baseRaw を裏切るのを止める＝段階1 までと同じ挙動）
   *   - 'reject-pm': plan21 T9 追加（B2 N6）。本ハンドラ自身では operation 化しないが、
   *                  PM 既定動作（list_item lift 等）を通したい場合に返す＝gesture は
   *                  false を返して PM 既定挙動を許す。現状の実 onParagraphJoinImpl は
   *                  list 2 番目以降を operation 化して 'joined' を返すため、本 variant は
   *                  forward-compat（将来 PM default に逃がしたい深い nested case 用）。
   *                  exhaustive check の前に明示分岐させる。
   */
  onParagraphJoin?: (
    direction: "backspace" | "delete",
  ) => "joined" | "noop" | "reject" | "reject-pm";
  /**
   * M-6（段階5）: 全 noop 上書き時の UI トースト通知。
   * handleTextInput で `tr === null && text.length > 0`（上書き入力を全破棄する場面）の時に呼ぶ。
   * app 側で `.akapen-statusbar` に「この箇所は編集できません」を 3 秒表示する。
   * console.warn は維持（デバッグ用）＋ UI 通知を追加（plan10 §0 M-6）。
   */
  onNoopOverwrite?: () => void;
  /**
   * plan18 T16: コメント範囲を含む削除をブロックした際の通知。
   * app 側で `.akapen-statusbar` に「コメントを含む削除はできません」を 3 秒表示する。
   * hook 不在の場合は console.warn のみ（UI 通知なし）。
   */
  onCommentDeleteBlocked?: () => void;
  /**
   * S6-9（段階6）: editor 初期化中フラグ（mountEditors の loadingEditors）を返す関数。
   * true の間は handleTextInput の onNoopOverwrite を発火しない（初期化中のスプリアストースト防止）。
   *
   * S7-6 INFO: このガードが `onNoopOverwrite` のみに適用される設計について。
   *   - handleKeyDown（Backspace/Delete）は loadingEditors ガードを持たない。
   *   - 理由: mountEditors の loadingEditors=true 期間中は PM への入力が届かない
   *     （Milkdown の focus/blur 管理により editor が ready になるまでキー入力を受け付けない）。
   *     そのため handleKeyDown が初期化中に呼ばれるパスは実際には存在しない。
   *   - onNoopOverwrite は handleTextInput 内で呼ばれる。handleTextInput は IME 変換候補の
   *     commitが ready 前に届くケースがあり、その際にスプリアス toast を出さないためガードが必要。
   */
  loadingEditors?: () => boolean;
}

/**
 * S7-3: critic 4マーク名を const-asserted tuple で一元定義し、Set と union 型を derived に。
 * 旧実装は Set リテラルと CriticMarkName union 型を別々に書いていた（divergence リスク＝
 * Set に追加して union 更新を忘れると isCriticMarkName が通すが型は絞り込まない）。
 * CRITIC_MARK_NAMES_ARRAY を single source of truth にすることで二重定義を解消する。
 */
export const CRITIC_MARK_NAMES_ARRAY = [
  "criticDeletion",
  "criticInsertion",
  "criticComment",
  "criticHighlight",
] as const;

/** critic 4マーク名（PM mark type 名）。削除区間の出自分類に使う。 */
const CRITIC_MARK_NAMES = new Set<string>(CRITIC_MARK_NAMES_ARRAY);

/**
 * 削除区間の処理種別。
 * - mark: base/highlight 由来＝criticDeletion を addMark（doc は縮まない・原文は消えない）
 * - drop: insertion（自分の追記）/comment 本文 由来＝本当に delete（縮む）
 * - noop: 既に criticDeletion の区間＝何もしない（条件①・原文を二重に触らない）
 */
type DeletedKind = "mark" | "drop" | "noop";

interface DeletedSeg {
  from: number;
  to: number;
  kind: DeletedKind;
}

/** gesture プラグインの観測カウンタ（e2e で「狙いが当たっているか」を機械 assert するため）。 */
export interface GestureMetrics {
  /** 削除を含むジェスチャを観測した回数 */
  observed: number;
  /**
   * 置換 tr を **dispatch した回数**（=非 null tr の生成成功）。
   * ⚠️ no-op パス（条件① の return null）はカウントしない＝「既定を抑止した総数」ではない。
   * 「既定を抑止した総数」は `normalized + realDrops + noops` で計算する
   *   （独立レビュー指摘 2026-06-13・docstring 明確化）。
   */
  suppressed: number;
  /** addMark(deletion) の正規化 tr を dispatch した回数 */
  normalized: number;
  /** insertion/comment 本文を本当に消した回数 */
  realDrops: number;
  /** 既に deletion の区間への削除系操作を no-op で握りつぶした回数（条件①） */
  noops: number;
  /** U5: critic デリミタ入力を弾いた回数（タイプ＋ペースト合計）。K3.5 段階2 追加 */
  notationBlocked: number;
  /**
   * K3.5 段階4（plan9）: 段落結合即時化が「joined」で発火した回数（hooks.onParagraphJoin
   *   が `'joined'` を返した時に +1）。条件①の noop は metrics.noops で数える＝段階1 と
   *   セマンティクスを揃える（取り消し線化が起きた回数 vs no-op 回数）。
   */
  paragraphJoins: number;
  lastDebug?: unknown;
}

const gestureKey = new PluginKey("akapenGesture");

/** S6-1 / S7-3: critic 4マーク名の union 型（CRITIC_MARK_NAMES_ARRAY から derived＝二重定義なし）。 */
type CriticMarkName = (typeof CRITIC_MARK_NAMES_ARRAY)[number];

/**
 * S6-1: PM mark type 名が critic 4マーク名かを絞り込む型ガード。
 * S7-6 INFO: Set.has() を使うことで型チェック（CriticMarkName への絞り込み）と
 * ランタイムチェック（CRITIC_MARK_NAMES_ARRAY 由来の Set）が同じ真実源から同期する。
 * 配列の includes() や手書き union 判定と異なり、CRITIC_MARK_NAMES_ARRAY に要素を
 * 追加するだけで Set/型ガード/CriticMarkName の3つが自動的に一致する設計。
 */
export function isCriticMarkName(n: string): n is CriticMarkName {
  return CRITIC_MARK_NAMES.has(n);
}

/** marks のうち critic 4マークの名前だけを抜き出す。 */
function criticMarksOf(marks: readonly Mark[]): CriticMarkName[] {
  return marks.map((m) => m.type.name).filter(isCriticMarkName);
}

/**
 * 削除区間 [from,to)（oldDoc 座標）を出自ごとに分類する。
 * - 既に criticDeletion → noop（条件①＝二重に触らない・原文無損失）
 * - criticInsertion のみ / criticComment 本文 → drop（本当に消える）
 * - それ以外（base/highlight 等） → mark（criticDeletion を addMark）
 */
export function classifyDeleted(
  oldDoc: PMNode,
  from: number,
  to: number,
): DeletedSeg[] {
  const segs: DeletedSeg[] = [];
  oldDoc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const nFrom = Math.max(pos, from);
    const nTo = Math.min(pos + node.nodeSize, to);
    if (nFrom >= nTo) return false;
    const crit = criticMarksOf(node.marks);
    const isAlreadyDeletion = crit.includes("criticDeletion");
    const isPureInsertion = crit.length === 1 && crit[0] === "criticInsertion";
    const isCommentBody = crit.includes("criticComment");
    // ⚠️ 条件①（plan6 §2-1）: 既に取り消し線（criticDeletion）の区間は最優先で no-op。
    // スパイク gesture2 はここを drop に倒し、2回目の削除で原文が doc から消えた（敵対検証 BLOCKER）。
    // deletion マーク済みへの削除系は「何もしない」＝原文を二重に触らない・黙って消さない。
    const kind: DeletedKind = isAlreadyDeletion
      ? "noop"
      : isPureInsertion || isCommentBody
        ? "drop"
        : "mark";
    segs.push({ from: nFrom, to: nTo, kind });
    return false;
  });
  return segs;
}

/**
 * 削除区間群 [from,to)（oldDoc 座標）を分類し、単一 tr を組む共通ロジック。
 * - mark → addMark(deletion)（縮まない）
 * - drop → delete（縮む）
 * - noop → 何もしない（条件①）
 * 加えて insertText（選択上書きのタイプ文字）を削除区間の右端へ入れる。
 * 後ろから前へ適用＝座標安定。insertText は最後に（addMark で縮まないので右端が安定）。
 *
 * 返値が null＝この tr では doc を変えない（純 noop 含む）。呼び出し側は既定操作を抑止しつつ
 * 何も dispatch しない（原文は守る）。
 */
function buildNormalizedTr(
  view: EditorView,
  oldDoc: PMNode,
  ranges: Array<{ from: number; to: number }>,
  deletionMarkType: MarkType,
  insertionMarkType: MarkType,
  insertedText: string,
  metrics: GestureMetrics,
): Transaction | null {
  const allSegs: DeletedSeg[] = [];
  for (const r of ranges)
    allSegs.push(...classifyDeleted(oldDoc, r.from, r.to));
  // noop だけ観測したら数えておく（条件①の発火カウンタ＝e2e 機械 assert 用）。
  const noopCount = allSegs.filter((s) => s.kind === "noop").length;
  if (noopCount > 0) metrics.noops += noopCount;

  const actionable = allSegs.filter((s) => s.kind !== "noop");
  // 条件①（plan6 §2-1）: 削除対象が「丸ごと既に取り消し線」で actionable が無い場合は、
  // 上書きタイプ文字があっても何も dispatch しない＝workingMd 不変・原文無損失を守る。
  // base 部分を含む（actionable あり）混在選択の上書きだけ、その base 区間を取り消し線化しつつ
  // タイプ文字を入れる（純粋な取り消し線済み区間は触らない）。
  if (actionable.length === 0) return null;

  const deletionMark = deletionMarkType.create();
  let tr = view.state.tr;
  let didDrop = false;
  let didMark = false;
  // 上書き挿入位置＝削除区間の右端（最大 to）。base は addMark で残るので
  // 取り消し線の「後ろ」へ追記を置く＝`{--world--}{++X++}`（消した→書いた の順）。
  const rightMost =
    ranges.length > 0
      ? Math.max(...ranges.map((r) => r.to))
      : view.state.selection.to;
  const ordered = [...actionable].sort((a, b) => b.from - a.from);
  for (const seg of ordered) {
    if (seg.kind === "mark") {
      tr = tr.addMark(seg.from, seg.to, deletionMark);
      didMark = true;
    } else {
      tr = tr.delete(seg.from, seg.to);
      didDrop = true;
    }
  }
  // drop で座標が縮んだ分、右端を mapping で写してから挿入。
  // ⚠️ 上書きのタイプ文字は criticInsertion を明示付与する＝結果を決定的に
  // `{--base--}{++typed++}` にする（gesture の tr は insertion-on-type の除外対象＝条件④ゆえ、
  // 暗黙のマーク継承に頼らず自分で付ける／1イベント・複数イベントどちらでも同じ結果）。
  if (insertedText.length > 0) {
    const at = tr.mapping.map(rightMost, -1);
    tr = tr.insertText(insertedText, at);
    tr = tr.addMark(at, at + insertedText.length, insertionMarkType.create());
  }
  if (!tr.docChanged) return null;
  if (didDrop) metrics.realDrops++;
  if (didMark) metrics.normalized++;
  metrics.lastDebug = {
    allSegs,
    insertedText,
    rightMost,
    didMark,
    didDrop,
    noopCount,
  };
  return tr.setMeta(AKAPEN_GESTURE_META, true).setMeta("addToHistory", true);
}

/**
 * gesture プラグインを生成する（Milkdown `$prose`＝ctx から deletion mark type を引く）。
 * 返り値の metrics は handle 経由で e2e から読む（「狙いが当たっているか」の機械 assert 用）。
 *
 * K3.5 段階2: hooks を省略可能引数として追加（既定 undefined＝段階1 互換）。
 * 既存の `createGesturePlugin()` 呼び出しは変更不要。
 */
export function createGesturePlugin(hooks?: GestureHooks): {
  prose: ReturnType<typeof $prose>;
  metrics: GestureMetrics;
} {
  const metrics: GestureMetrics = {
    observed: 0,
    suppressed: 0,
    normalized: 0,
    realDrops: 0,
    noops: 0,
    notationBlocked: 0,
    paragraphJoins: 0,
  };

  const prose = $prose((ctx) => {
    const deletionType = deletionSchema.type(ctx);
    const insertionType = insertionSchema.type(ctx);
    let view: EditorView | null = null;
    const composing = (): boolean => view?.composing === true;

    return new Plugin({
      key: gestureKey,
      view: (v) => {
        view = v;
        return { destroy: () => (view = null) };
      },
      props: {
        /**
         * Backspace/Delete を握りつぶし、単一 tr（addMark(deletion) or 追記 delete or no-op）に置換する。
         * 同期 dispatch＝1 tr が undo 履歴の1単位（Ctrl+Z で取り消し線が外れる＝U1）。
         */
        handleKeyDown: (v, event) => {
          if (composing()) return false;
          const key = event.key;
          if (key !== "Backspace" && key !== "Delete") return false;
          const { state } = v;
          const sel = state.selection;
          let from: number;
          let to: number;
          if (!sel.empty) {
            from = sel.from;
            to = sel.to;
          } else if (key === "Backspace") {
            if (sel.from === 0) return false;
            // 直前の1書記素（最小 1 char）。
            const $f = state.doc.resolve(sel.from);
            // K3.5 段階4（plan9 §0/§4 D1）: ブロック頭 Backspace（段落結合方向）は段階1 まで
            //   既定挙動を通して fold C1 LOUD_STOP に倒していた（safety bias）。段階4 で hooks
            //   経由の **段落結合即時化**（workingMd の `\n\n` を `{--\n\n--}` で囲む・PM doc 不変）
            //   を被せる。hooks 不在 or 'reject' は段階1 と同じ挙動（fold C1 に委ねる）。
            if ($f.parentOffset === 0) {
              const result = hooks?.onParagraphJoin?.("backspace");
              if (result === "joined") {
                metrics.paragraphJoins++;
                return true; // 既定の段落結合を抑止（workingMd は hooks が更新済み）
              }
              if (result === "noop") {
                metrics.noops++;
                return true; // 取り消し線済みの `\n\n` への再操作＝何もしない（条件①同型）
              }
              // plan21 T9（B2 N6）: 'reject-pm' は app.ts 側が「本ハンドラでは operation 化
              //   しないが PM 既定動作を通したい」と判断したケース。gesture は false を返して
              //   PM の段落結合（list_item lift 等）を許す。現状の onParagraphJoinImpl は
              //   list-subsequent-item を 'joined' で返すため本 variant は forward-compat。
              //   exhaustive check より先に分岐する。
              if (result === "reject-pm") return false;
              // S6-3: union 拡張時の地雷防止。既知 variant（joined/noop/reject/reject-pm）を全排除した残りは
              // 現在 never（dead code）。将来 onParagraphJoin 戻り値 union に variant が追加されると
              // ここで TypeScript エラーになり見落としを防ぐ。
              // S7-6 INFO: `result !== undefined && result !== 'reject'` の二重条件について。
              //   hooks?.onParagraphJoin?.() は hooks 不在の場合 undefined を返す（? 演算子）。
              //   undefined は '_exhaustive: never' チェックの対象外（「hooks が来なかった」は union 外）。
              //   'reject' は S7-9 で return true に変更したため exhaustive check の前で分岐が必要なく
              //   なったが、この check 自体は「defined かつ既知でない」variant 検出が目的なので除外する。
              if (result !== undefined && result !== "reject") {
                const _exhaustive: never = result;
                void _exhaustive;
              }
              // S7-9: 'reject'（terminator guard 等で段落結合不可）の場合は return true で
              // PM 既定動作（段落境界除去）を抑止する。
              // return false だと PM が `\n\n` を除去 → fold が multi-block LOUD_STOP → showError
              // になる問題（K3-10h noError の根本原因）を修正。
              // M-4: hooks 不在（result === undefined）の挙動補足。
              //   段階4 以降は createGesturePlugin を呼ぶ mountEditors が常に hooks を渡すため、
              //   通常の実行経路で hooks 不在になることはない。hooks === undefined は
              //   段階1（hooks 引数なし呼び出し）互換のための安全弁であり、実質的に想定外経路。
              //   hooks 不在で 'reject' が来ることはない（? 演算子で undefined が返るだけ）。
              //   hooks 不在では return false（段階1 と同じ＝PM 既定動作を通す）に倒す設計。
              if (result === "reject") return true;
              return false; // hooks 不在（undefined）＝段階1 と同じ＝既定挙動を通す
            }
            from = sel.from - 1;
            to = sel.from;
          } else {
            // Delete（前方削除）
            const $f = state.doc.resolve(sel.from);
            // K3.5 段階4（plan9 §0/§4 D1）: ブロック末 Delete（段落結合方向）も同型。
            if ($f.parentOffset >= $f.parent.content.size) {
              const result = hooks?.onParagraphJoin?.("delete");
              if (result === "joined") {
                metrics.paragraphJoins++;
                return true;
              }
              if (result === "noop") {
                metrics.noops++;
                return true;
              }
              // plan21 T9（B2 N6）: 'reject-pm' Backspace ブランチと同型＝PM 既定動作を許す。
              if (result === "reject-pm") return false;
              // S6-3: Backspace ブランチと同型の exhaustive check（将来 variant 追加時の地雷防止）。
              // S7-6 INFO: Backspace ブランチのコメント参照（undefined 除外・'reject' 除外の理由）。
              if (result !== undefined && result !== "reject") {
                const _exhaustive: never = result;
                void _exhaustive;
              }
              // S7-9: Backspace ブランチと同型。'reject' は return true で PM 既定動作を抑止。
              // hooks 不在（result === undefined）の場合は従来通り return false。
              if (result === "reject") return true;
              return false;
            }
            from = sel.from;
            to = sel.from + 1;
          }
          // plan30: コメント範囲を含む削除をブロック（PM doc marks 直接チェック）。
          {
            let hasComment = false;
            v.state.doc.nodesBetween(from, to, (node) => {
              if (
                node.isText &&
                node.marks.some(
                  (m) =>
                    m.type.name === "criticComment" ||
                    m.type.name === "criticHighlight",
                )
              ) {
                hasComment = true;
              }
              return !hasComment;
            });
            if (hasComment) {
              console.warn("[akapen] gesture: コメントを含む削除はできません");
              hooks?.onCommentDeleteBlocked?.();
              return true;
            }
          }
          metrics.observed++;
          const tr = buildNormalizedTr(
            v,
            state.doc,
            [{ from, to }],
            deletionType,
            insertionType,
            "",
            metrics,
          );
          if (!tr) return true; // 何もしないが既定の削除は抑止（原文を守る／条件① no-op 含む）
          metrics.suppressed++;
          // addMark はdocサイズを変えないため PM の selection mapping がカーソルを移動しない。
          // 明示的にカーソルを移動しないと2回目の Backspace/Delete が同じ文字を対象にして noop で停止する。
          if (sel.empty) {
            const cursorTarget = key === "Backspace" ? from : to;
            const mapped = tr.mapping.map(
              cursorTarget,
              key === "Backspace" ? -1 : 1,
            );
            tr.setSelection(TextSelection.create(tr.doc, mapped));
          }
          v.dispatch(tr);
          return true;
        },
        /**
         * 選択上書き（非空選択へのタイプ）を握りつぶし、単一 tr（base 削除→deletion・
         * insertion 由来 drop・deletion 済みは no-op・タイプ文字 insert）に置換する。
         * 選択が空なら既定通り通す（純タイプは insertion-on-type が拾う）。
         *
         * K3.5 段階2 U5: 先頭で critic デリミタ形成を検査し弾く（段階1 の選択上書きロジック
         * buildNormalizedTr は U5 を通過した後に走る＝段階1 挙動を一切変えない・条件 U5-3）。
         */
        handleTextInput: (v, from, to, text) => {
          if (composing()) return false;
          // U5 ガード: 挿入位置の前後文脈と text を合わせて critic デリミタが成るなら弾く。
          // 段階1 の選択上書きロジック（buildNormalizedTr）より先に走る（条件 U5-3）。
          if (formsCriticDelimiter(v, from, to, text)) {
            // 検出されたデリミタを特定: 前後文脈＋text の局所文字列から最初に見つかったものを通知。
            const { doc: d } = v.state;
            const before = d.textBetween(
              Math.max(0, from - 3),
              from,
              "\n",
              "\n",
            );
            const after = d.textBetween(
              to,
              Math.min(d.content.size, to + 3),
              "\n",
              "\n",
            );
            const local = before + text + after;
            const detected =
              CRITIC_DELIMITERS.find((delim) => local.includes(delim)) ?? text;
            metrics.notationBlocked++;
            hooks?.onNotationBlocked?.(detected);
            return true; // 既定挿入を抑止・doc 不変
          }
          if (from === to) {
            // M-6（段階5）: 空選択でもカーソル位置が criticDeletion ラン内なら noop。
            // 純タイプを通す既定経路（return false）の前に criticDeletion 位置チェックを挟む。
            // カーソル直前（from-1 〜 from）の1文字区間を classifyDeleted で確認する。
            // from === 0（段落先頭）は前文字なし→純タイプとして通す。
            if (from > 0) {
              const segs = classifyDeleted(v.state.doc, from - 1, from);
              const inDeletion =
                segs.length > 0 && segs.every((s) => s.kind === "noop");
              if (inDeletion) {
                metrics.noops++;
                if (text.length > 0) {
                  console.warn(
                    "[akapen] gesture: カーソルが取り消し線済みテキスト内のため入力を破棄しました（原文は無損失）",
                  );
                  // S6-9: editor 初期化中（mountEditors の loadingEditors フラグが立っている間）は
                  // スプリアス toast を防ぐためスキップ。
                  if (!hooks?.loadingEditors?.()) {
                    hooks?.onNoopOverwrite?.();
                  }
                }
                return true; // 既定挿入を抑止・doc 不変
              }
            }
            return false; // 空選択かつ deletion 外＝純タイプ（insertion-on-type が拾う）
          }
          // plan30: コメント範囲を含む選択上書きをブロック（PM doc marks 直接チェック）。
          {
            let hasComment = false;
            v.state.doc.nodesBetween(from, to, (node) => {
              if (
                node.isText &&
                node.marks.some(
                  (m) =>
                    m.type.name === "criticComment" ||
                    m.type.name === "criticHighlight",
                )
              ) {
                hasComment = true;
              }
              return !hasComment;
            });
            if (hasComment) {
              console.warn("[akapen] gesture: コメントを含む削除はできません");
              hooks?.onCommentDeleteBlocked?.();
              return true;
            }
          }
          metrics.observed++;
          const tr = buildNormalizedTr(
            v,
            v.state.doc,
            [{ from, to }],
            deletionType,
            insertionType,
            text,
            metrics,
          );
          if (!tr) {
            // 既定の置換を抑止（条件① no-op で原文を消さない）。
            // ⚠️ 純 noop 上書き（選択が全区間 criticDeletion 済み＝actionable=0）の場合、
            // typed 文字も dispatch されない＝**ユーザーが打った文字が画面に出ない**。
            // データ整合性は守られる（原文無損失）が UX 上は無音消滅。console.warn は維持し、
            // M-6（段階5）: onNoopOverwrite フック経由で UI トーストにも昇格させる。
            if (text.length > 0) {
              console.warn(
                "[akapen] gesture: 上書き入力を破棄しました（選択範囲が全て取り消し線済み・原文は無損失）",
              );
              // S6-9: editor 初期化中はスプリアス toast を防ぐためスキップ。
              if (!hooks?.loadingEditors?.()) {
                hooks?.onNoopOverwrite?.();
              }
            }
            return true;
          }
          metrics.suppressed++;
          v.dispatch(tr);
          return true; // 既定の置換を抑止
        },
        /**
         * K3.5 段階2 U5: ペーストに critic デリミタが含まれる場合の部分通過（plan7 §0/§2）。
         * spike gesture2.ts は「全か無か」だったが plan7 確定で**部分通過**に変更:
         *   - デリミタ8種を文字列置換で除去→残りを insertText で挿入＋通知。
         *   - 除去後が空文字列ならペーストごと捨てる（return true・通知）。
         *   - デリミタなしなら既定のペーストを通す（return false）。
         * handlePaste で自前 insertText する経路は段階1の choose-overwrite と異なるため
         * マーク継承なし＝地の文として挿入される（condition UI-1: doc に染まない）。
         */
        handlePaste: (v, event) => {
          const text = event.clipboardData?.getData("text/plain") ?? "";
          if (!hasCriticDelimiter(text)) return false; // デリミタなし→既定ペースト
          // 検出されたデリミタを通知用に記録（最初に見つかったもの）
          const detected =
            CRITIC_DELIMITERS.find((d) => text.includes(d)) ?? text;
          // 部分通過: 8種のデリミタを順次除去
          let stripped = text;
          for (const d of CRITIC_DELIMITERS) {
            stripped = stripped.split(d).join("");
          }
          metrics.notationBlocked++;
          const { state } = v;
          const sel = state.selection;
          if (sel.empty) {
            if (stripped.length > 0) {
              v.dispatch(state.tr.insertText(stripped, sel.from));
            }
            hooks?.onNotationBlocked?.(detected);
            return true;
          }
          // 非空 selection＝段階1 K3-6c-overwrite-immediate-marks と同型に倒す。
          // ⚠️ 旧実装は state.tr.insertText(stripped, from, to) で selection 範囲を置換＝
          // base が criticDeletion マークなしに消える A2' サイレント違反（独立レビュー
          // silent-failure-hunter HIGH-1 が指摘・K3-7i で実機再現 2026-06-13）。
          // 修正＝buildNormalizedTr 経由で base→addMark(deletion)・stripped を criticInsertion で
          // 右端追記（段階1 と完全同型）。tr===null は actionable=0+stripped=空＝K3-6e2 同型の no-op。
          const tr = buildNormalizedTr(
            v,
            state.doc,
            [{ from: sel.from, to: sel.to }],
            deletionType,
            insertionType,
            stripped,
            metrics,
          );
          if (tr) {
            v.dispatch(tr);
            hooks?.onNotationBlocked?.(detected);
          } else {
            // K3-11e: tr===null は actionable=0（選択範囲が丸ごと削除マーク内等の noop）。
            // stripped が空でない場合も含め、「削除済み範囲への書き込みは noop」が
            // 実態であり onNoopOverwrite で通知する（onNotationBlocked は誤解を招く）。
            hooks?.onNoopOverwrite?.();
          }
          return true; // 既定ペーストを抑止
        },
      },
    });
  });

  return { prose, metrics };
}
