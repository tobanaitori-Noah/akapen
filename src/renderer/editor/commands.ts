/**
 * commands.ts — PM marks / commands 直接操作の編集コマンド
 *
 * plan30 v5: PM doc が真実源。全コマンドは PM marks / commands で直接操作。
 * v4 の OperationStore / derive.ts 座標変換は廃止済み。
 */
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import type { MarkType, Node as PMNode } from "@milkdown/kit/prose/model";
import { toggleMark as pmToggleMark } from "@milkdown/kit/prose/commands";
import { wrapInList as pmWrapInList } from "@milkdown/kit/prose/schema-list";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

/** コマンド適用 tr の印（旧 insertion-on-type の除外用・後方互換のため残す）。 */
export const AKAPEN_COMMAND_META = "akapen-command";

// ---------------------------------------------------------------------------
// CommandContext
// ---------------------------------------------------------------------------

/**
 * 編集コマンドが必要とする依存を 1 つにまとめたコンテキスト。
 * plan30 v5: PM doc が真実源。全コマンドは PM marks / commands で直接操作する。
 */
export interface CommandContext {
  editor: Editor;
  /** コマンドが PM doc を変更した直後の app 側同期フック。 */
  onEdited?: () => void;
  /** plan18 T16: コメント含む削除をブロックした時に呼ぶコールバック（省略可）。 */
  onCommentDeleteBlocked?: () => void;
  /**
   * plan19 T29 (HIGH-3 反映): コメント操作で選択範囲が見出し行をまたいだ時に呼ぶ
   * コールバック（省略可）。呼び出し側（app.ts）で bridge.confirm を kind 別に出し分け、
   * 必要に応じて trim 範囲で applyComment を再呼び出しする。
   *
   * - `single`: 見出し以外の本文範囲が 1 つ → OK で trim 範囲コメント / Cancel で中止
   * - `multiple`: 中間見出しで本文が複数断片に分かれる → 操作中止（OK ボタンのみ）
   * - `empty`: トリミング後に本文が残らない → 操作中止（OK ボタンのみ）
   */
  onHeadingCrossed?: (trim: TrimResult) => void;
}

// ---------------------------------------------------------------------------
// 見出しまたぎ判定（plan19 T27/T28・HIGH-3 反映）
// ---------------------------------------------------------------------------

/**
 * plan19 T28: `trimSelectionByHeadings` の戻り値型（HIGH-3 反映で 3 ケース対応）。
 *
 * - `single`: 見出し以外の本文範囲が 1 つだけ → そのままコメント対象
 * - `multiple`: 中間見出しで本文が複数断片に分かれる → 呼び出し側でキャンセル推奨
 * - `empty`: トリミング後に本文が残らない → 呼び出し側でキャンセル
 */
export type TrimResult =
  | { kind: "single"; from: number; to: number }
  | { kind: "multiple"; segments: Array<{ from: number; to: number }> }
  | { kind: "empty" };

/**
 * plan19 T27: 選択範囲 [from, to) が baseRaw 上で見出し行（`/^#{1,6} /`）を
 * またぐかを判定する純粋関数。
 *
 * ## 判定ルール
 * - [from, to) 区間内に「行頭一致 `/^#{1,6} /`」する位置 p があれば true
 * - 「行頭」= p === 0 もしくは baseRaw[p-1] === '\n'
 * - 選択がちょうど見出し行を含む / 一部含む / 見出しの真ん中で開始するケースを
 *   含む（行頭が選択範囲に入るかで判定）
 *
 * ## 含まれないケース
 * - 選択が見出し行の途中（行頭が選択範囲の外）から始まり、次の見出しを含まない場合
 *   → その選択は heading を「またぐ」とは見なさない（行頭マーカーが選択範囲外）
 *
 * ## 文字列操作のみ（mdast 不要）
 * baseRaw は canonicalizeBrLines により改行が `\n` 統一済（v1.5+）。
 *
 * @param baseRaw 検査対象の文字列（state.baseRaw）
 * @param from   選択開始位置（inclusive・0 <= from <= baseRaw.length）
 * @param to     選択終了位置（exclusive・from <= to <= baseRaw.length）
 * @returns 見出し行をまたぐなら true
 */
export function selectionCrossesHeading(
  baseRaw: string,
  from: number,
  to: number,
): boolean {
  if (from < 0 || to > baseRaw.length || from >= to) return false;
  for (let p = from; p < to; p++) {
    const isLineStart = p === 0 || baseRaw[p - 1] === "\n";
    if (!isLineStart) continue;
    if (matchesHeadingPrefix(baseRaw, p)) return true;
  }
  return false;
}

/**
 * plan19 T28 (HIGH-3): 選択範囲 [from, to) から見出し行を除いた本文範囲を返す。
 *
 * ## アルゴリズム
 * 1. 見出し行の位置をスキャン（[lineStart, lineEnd] で `# `〜次の `\n` 直後 or 末尾）
 * 2. [from, to) から見出し行スパンを引いた残りを segments[] として並べる
 * 3. 各 segment の前後の空白/改行（`\n`/`\r`/空白）を trim
 * 4. 残った segments の数で kind を決定:
 *    - 0 件 → `empty`
 *    - 1 件 → `single`
 *    - 2 件以上 → `multiple`
 *
 * ## 見出し行スパンの定義
 * - 先頭: 行頭位置 p（`# ` 等で始まる）
 * - 末尾: 次の `\n` 直後（包含）または baseRaw.length（末尾行で `\n` がない場合）
 *
 * ## 「最小範囲」の意味
 * 各 segment の前後の改行/空白を trim して、コメント対象として自然な範囲に絞る。
 * （baseRaw の `\n` だけのスペースに critic マークを付けない）
 *
 * @param baseRaw 検査対象の文字列（state.baseRaw）
 * @param from   選択開始位置（inclusive）
 * @param to     選択終了位置（exclusive）
 * @returns TrimResult の 3 ケースのいずれか
 */
export function trimSelectionByHeadings(
  baseRaw: string,
  from: number,
  to: number,
): TrimResult {
  if (from < 0 || to > baseRaw.length || from >= to) return { kind: "empty" };

  // 1) [from, to) 内の見出し行スパン [hStart, hEnd) を全列挙
  type Span = { start: number; end: number };
  const headingSpans: Span[] = [];
  for (let p = from; p < to; p++) {
    const isLineStart = p === 0 || baseRaw[p - 1] === "\n";
    if (!isLineStart) continue;
    if (!matchesHeadingPrefix(baseRaw, p)) continue;
    // 行末を探す（次の '\n' の直後 or baseRaw.length）
    const nl = baseRaw.indexOf("\n", p);
    const hStart = p;
    const hEnd = nl === -1 ? baseRaw.length : nl + 1; // \n 直後を end とする
    headingSpans.push({ start: hStart, end: hEnd });
    // 次のスキャンは hEnd から（同じ行を二重に検出しない）
    p = hEnd - 1; // for-loop の ++ で hEnd に進む
  }

  if (headingSpans.length === 0) {
    // 見出しなし＝そのまま single
    const trimmed = trimSegment(baseRaw, from, to);
    if (trimmed === null) return { kind: "empty" };
    return { kind: "single", from: trimmed.from, to: trimmed.to };
  }

  // 2) [from, to) から見出しスパンを引いた残りを segments[] として並べる
  const segments: Array<{ from: number; to: number }> = [];
  let cursor = from;
  for (const span of headingSpans) {
    const segStart = cursor;
    const segEnd = Math.min(span.start, to);
    if (segEnd > segStart) {
      const trimmed = trimSegment(baseRaw, segStart, segEnd);
      if (trimmed !== null) segments.push(trimmed);
    }
    cursor = Math.max(cursor, span.end);
  }
  // 末尾の残り
  if (cursor < to) {
    const trimmed = trimSegment(baseRaw, cursor, to);
    if (trimmed !== null) segments.push(trimmed);
  }

  if (segments.length === 0) return { kind: "empty" };
  if (segments.length === 1) {
    return { kind: "single", from: segments[0].from, to: segments[0].to };
  }
  return { kind: "multiple", segments };
}

/**
 * 位置 p が `/^#{1,6} /` パターン（H1〜H6 の行頭）に一致するか。
 * 内部ヘルパ（selectionCrossesHeading / trimSelectionByHeadings 共有）。
 */
function matchesHeadingPrefix(baseRaw: string, p: number): boolean {
  let i = p;
  let hashCount = 0;
  while (i < baseRaw.length && baseRaw[i] === "#") {
    hashCount++;
    i++;
    if (hashCount > 6) return false;
  }
  if (hashCount < 1 || hashCount > 6) return false;
  // `#` の直後が ' '
  return baseRaw[i] === " ";
}

/**
 * セグメント [from, to) の前後の改行/空白を trim する。
 * trim 後に長さが 0 なら null。
 */
function trimSegment(
  baseRaw: string,
  from: number,
  to: number,
): { from: number; to: number } | null {
  let a = from;
  let b = to;
  while (a < b && isTrimChar(baseRaw[a])) a++;
  while (b > a && isTrimChar(baseRaw[b - 1])) b--;
  if (a >= b) return null;
  return { from: a, to: b };
}

function isTrimChar(c: string): boolean {
  return c === "\n" || c === "\r" || c === " " || c === "\t";
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

/**
 * plan21 T11 (B4): PM doc 上の位置を derivedMd 上の位置に **直接** 変換する純粋関数。
 *
 * ## 旧 3 ステップ変換の問題（plan20 T8 path B フォールバックの遠因）
 *
 * 旧実装は pmPos → displayedText offset → derivedMd pos → baseRaw pos の 3 段で
 * 変換していたが、`pmPositionToDerivedTextOffset` の「PM doc 上のテキスト累計」と
 * `displayedPositionToDerived` の「displayedText 上の位置」は実は一致しない：
 *
 * - PM doc text は **コメントマーカー `{==…==}{>>…<<}` を含まない**
 *   （critic.ts の remark plugin が mark で wrap し markers を strip するため）
 * - displayedText (acceptAllForDisplay) は **コメントマーカーを literal として残す**
 * - PM doc text は **削除テキストを含む**（criticDeletion mark 付き）
 * - displayedText は **削除テキストを strip する**
 *
 * これが C16（削除 + コメントの組合せ）で誤った range を返す根本原因。plan20 T8 は
 * path B（選択テキスト一致）でフォールバックしていたが、plan21 T11 で **PM doc を
 * 直接歩いて mark 境界に応じて derived position をカウントする**ことで根治する。
 *
 * ## アルゴリズム
 *
 * PM doc を text node 順に走査し、`criticDeletion` / `criticInsertion` /
 * `criticHighlight` / `criticComment` mark の境界遷移ごとに対応する CriticMarkup
 * 記号の文字数を derived position に加算する：
 *
 * | mark             | 開きタグ | 閉じタグ |
 * |------------------|---------|---------|
 * | criticDeletion   | `{--`    | `--}`    |
 * | criticInsertion  | `{++`    | `++}`    |
 * | criticHighlight  | `{==`    | `==}`    |
 * | criticComment    | `{>>`    | `<<}`    |
 *
 * 各 text node の text 自体も derived に 1:1 で写るため、その長さを加算する
 * （deletion mark の中身も derived 上には残るので加算対象）。
 *
 * ## block 区切り（`\n\n`）
 *
 * top-level block が 2 個目以降に到達した時点で `\n\n`（2 文字）を derived に加算
 * する（app.ts の同名ヘルパと同型の補正）。block-open/close の PM 座標は text 累計
 * に反映されないが derivedMd には paragraph 区切りとして `\n\n` が出現するため。
 *
 * @param doc - PM doc node
 * @param pmPos - PM 上の位置（doc.content.size 以下にクランプされる）
 * @returns derivedMd 上の位置（0 以上）
 */
export function pmDocPositionToDerivedPos(
  doc: PMNode,
  pmPos: number,
  derivedMd?: string,
): number {
  const clampedPos = Math.min(Math.max(pmPos, 0), doc.content.size);

  // 各 critic mark の現在状態（直前まで「内側」にいるか）
  let inDeletion = false;
  let inInsertion = false;
  let inHighlight = false;
  let inComment = false;

  let derivedPos = 0;
  let pmConsumed = 0;
  let blockIndex = 0;
  // text node 走査の途中で pmPos に到達 or 超過したら即終了
  let done = false;

  doc.forEach((blockNode, blockPos) => {
    if (done) return;

    if (blockIndex > 0) {
      if (blockPos >= clampedPos) {
        done = true;
        return;
      }
      // block を跨いだ時点で前 block の open mark は終了扱い
      if (inDeletion) {
        derivedPos += 3;
        inDeletion = false;
      }
      if (inInsertion) {
        derivedPos += 3;
        inInsertion = false;
      }
      if (inHighlight) {
        derivedPos += 3;
        inHighlight = false;
      }
      if (inComment) {
        derivedPos += 3;
        inComment = false;
      }
      // block separator: derivedMd が渡されていれば実際の改行数を読む
      if (derivedMd) {
        let sep = 0;
        while (
          derivedPos + sep < derivedMd.length &&
          derivedMd.charCodeAt(derivedPos + sep) === 0x0a
        ) {
          sep++;
        }
        derivedPos += sep || 2;
      } else {
        derivedPos += 2; // fallback: '\n\n'
      }
    }
    blockIndex++;

    // heading prefix: derivedMd から実際の '#... ' を読む
    if (derivedMd && blockNode.type.name === "heading") {
      let prefixLen = 0;
      while (
        derivedPos + prefixLen < derivedMd.length &&
        derivedMd.charCodeAt(derivedPos + prefixLen) === 0x23 // '#'
      ) {
        prefixLen++;
      }
      if (
        prefixLen > 0 &&
        derivedPos + prefixLen < derivedMd.length &&
        derivedMd.charCodeAt(derivedPos + prefixLen) === 0x20 // ' '
      ) {
        prefixLen++;
      }
      derivedPos += prefixLen;
    }

    // list marker: derivedMd から実際の '- ' / '* ' を読む (最初の list_item 分)
    if (
      derivedMd &&
      (blockNode.type.name === "bullet_list" ||
        blockNode.type.name === "ordered_list")
    ) {
      let markerLen = 0;
      const startPos = derivedPos;
      while (
        startPos + markerLen < derivedMd.length &&
        derivedMd.charCodeAt(startPos + markerLen) !== 0x20 // space の手前まで
      ) {
        markerLen++;
      }
      if (startPos + markerLen < derivedMd.length) {
        markerLen++; // space を含む
      }
      derivedPos += markerLen;
    }

    const isList =
      blockNode.type.name === "bullet_list" ||
      blockNode.type.name === "ordered_list";
    let listItemIndex = 0;

    blockNode.nodesBetween(0, blockNode.content.size, (node, innerPos) => {
      if (done) return false;

      // list_item 間の separator + marker を derivedMd から読む
      if (derivedMd && isList && node.type.name === "list_item") {
        if (listItemIndex > 0) {
          const liPmStart = blockPos + 1 + innerPos;
          if (clampedPos <= liPmStart) {
            done = true;
            return false;
          }
          // '\n- ' 等を derivedMd から読む
          let markerLen = 0;
          // newline(s)
          while (
            derivedPos + markerLen < derivedMd.length &&
            derivedMd.charCodeAt(derivedPos + markerLen) === 0x0a
          ) {
            markerLen++;
          }
          // marker chars (- / * / 1. etc) + space
          while (
            derivedPos + markerLen < derivedMd.length &&
            derivedMd.charCodeAt(derivedPos + markerLen) !== 0x0a &&
            derivedMd.charCodeAt(derivedPos + markerLen) !== 0x20
          ) {
            markerLen++;
          }
          if (derivedPos + markerLen < derivedMd.length) {
            markerLen++; // trailing space
          }
          derivedPos += markerLen;
        }
        listItemIndex++;
        return true;
      }

      if (!node.isText) {
        if (node.type.name === "hardbreak") {
          const hbPmStart = blockPos + 1 + innerPos;
          if (clampedPos <= hbPmStart) {
            done = true;
            return false;
          }
          derivedPos += 3; // hardbreak = '  \n' in derivedMd
        }
        return true;
      }

      const pmStart = blockPos + 1 + innerPos; // block-open=+1
      const text = node.text ?? "";
      const textLen = text.length;
      const pmEnd = pmStart + textLen;

      // pmPos がこの text node の手前 or 先頭 boundary → 既に終わっている
      if (clampedPos <= pmStart) {
        done = true;
        return false;
      }

      const marks = node.marks;
      const hasDeletion = marks.some((m) => m.type.name === "criticDeletion");
      const hasInsertion = marks.some((m) => m.type.name === "criticInsertion");
      const hasHighlight = marks.some((m) => m.type.name === "criticHighlight");
      const hasComment = marks.some((m) => m.type.name === "criticComment");

      // close transitions: 直前 text node に乗っていた mark がこの node で外れていたら
      // derivedMd 上は閉じタグ分を加算する。
      // 「外れていて、かつ次の text を実際に消費する（remaining > 0）」場合のみ加算する。
      if (inDeletion && !hasDeletion) {
        derivedPos += 3; // '--}'
        inDeletion = false;
      }
      if (inInsertion && !hasInsertion) {
        derivedPos += 3; // '++}'
        inInsertion = false;
      }
      if (inHighlight && !hasHighlight) {
        derivedPos += 3; // '==}'
        inHighlight = false;
      }
      if (inComment && !hasComment) {
        derivedPos += 3; // '<<}'
        inComment = false;
      }

      // open transitions: この node で新たに mark が乗ったら開きタグ分を加算する。
      // pmPos が text node の先頭 boundary を既に過ぎている（clampedPos > pmStart）状態で
      // ここに到達しているので、open タグは必ず derivedMd 上で「跨ぐ」ことになる。
      if (hasDeletion && !inDeletion) {
        derivedPos += 3; // '{--'
        inDeletion = true;
      }
      if (hasInsertion && !inInsertion) {
        derivedPos += 3; // '{++'
        inInsertion = true;
      }
      if (hasHighlight && !inHighlight) {
        derivedPos += 3; // '{=='
        inHighlight = true;
      }
      if (hasComment && !inComment) {
        derivedPos += 3; // '{>>'
        inComment = true;
      }

      // text 加算（pmPos に到達するまで）
      const remaining = clampedPos - pmStart;
      const consumeNow = Math.min(textLen, remaining);
      derivedPos += consumeNow;
      pmConsumed = pmStart + consumeNow;

      if (pmConsumed >= clampedPos) {
        // text 内部 or text の直後 boundary に到達。
        // 後者の場合、次の text node の close transitions（hasMark が変わる場合）は
        // 「跨がない」扱い＝ここで止まる（boundary 上は close タグ前の位置に立つ）。
        done = true;
        return false;
      }
      return false;
    });
  });

  return derivedPos;
}

/**
 * 選択範囲を削除マーク化する。
 *
 * plan30 Phase 1: PM marks（criticDeletion）の addMark で直接マークを付ける。
 * テキストは PM doc に残す（物理削除しない）。赤の取り消し線は CSS で表示。
 * v4 の OperationStore / 座標変換は経由しない。
 *
 * 選択が空なら何もせず false。
 */
export function applyDeletion(ctx: CommandContext): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const { from, to, empty } = view.state.selection;
    if (empty) return false;
    // コメント範囲を含む選択への削除マーク付与をブロック
    const commentMarkType = view.state.schema.marks["criticComment"];
    const highlightMarkType = view.state.schema.marks["criticHighlight"];
    let hasComment = false;
    view.state.doc.nodesBetween(from, to, (node) => {
      if (hasComment) return false;
      if (node.isText) {
        if (commentMarkType?.isInSet(node.marks)) hasComment = true;
        if (highlightMarkType?.isInSet(node.marks)) hasComment = true;
      }
      return true;
    });
    if (hasComment) {
      ctx.onCommentDeleteBlocked?.();
      return false;
    }
    const deletionMarkType = view.state.schema.marks["criticDeletion"];
    const insertionMarkType = view.state.schema.marks["criticInsertion"];
    if (!deletionMarkType) return false;
    if (rangeHasMark(view.state.doc, { from, to }, deletionMarkType)) {
      return false;
    }

    if (!insertionMarkType) {
      const tr = view.state.tr.addMark(from, to, deletionMarkType.create());
      view.dispatch(tr);
      ctx.onEdited?.();
      return true;
    }

    const ranges: Array<{ from: number; to: number; inserted: boolean }> = [];
    view.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true;
      const textLen = node.text?.length ?? 0;
      const rangeFrom = Math.max(from, pos);
      const rangeTo = Math.min(to, pos + textLen);
      if (rangeFrom >= rangeTo) return false;
      ranges.push({
        from: rangeFrom,
        to: rangeTo,
        inserted: Boolean(insertionMarkType.isInSet(node.marks)),
      });
      return false;
    });

    if (ranges.length === 0) return false;

    let tr = view.state.tr;
    for (const range of ranges) {
      const mappedFrom = tr.mapping.map(range.from, -1);
      const mappedTo = tr.mapping.map(range.to, 1);
      if (mappedFrom >= mappedTo) continue;
      if (range.inserted) {
        tr = tr.delete(mappedFrom, mappedTo);
      } else {
        tr = tr.addMark(mappedFrom, mappedTo, deletionMarkType.create());
      }
    }
    if (tr.steps.length === 0) return false;
    view.dispatch(tr);
    ctx.onEdited?.();
    return true;
  });
}

export type EnterSelectionDeletionResult = "changed" | "handled" | "not-applicable";

/**
 * preview で非空選択の Enter を押した時に、PM の既定挙動が選択文字を物理削除する前に
 * 削除マーク化する。改行そのものは呼び出し側（milkdown.ts）が、この処理後に PM の
 * splitBlock/list split として実行する。
 */
export function markSelectionAsDeletionBeforeEnter(
  view: EditorView,
  opts: { onCommentDeleteBlocked?: () => void } = {},
): EnterSelectionDeletionResult {
  const { from, to, empty } = view.state.selection;
  if (empty) return "not-applicable";

  const commentMarkType = view.state.schema.marks["criticComment"];
  const highlightMarkType = view.state.schema.marks["criticHighlight"];
  let hasComment = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (hasComment) return false;
    if (node.isText) {
      if (commentMarkType?.isInSet(node.marks)) hasComment = true;
      if (highlightMarkType?.isInSet(node.marks)) hasComment = true;
    }
    return true;
  });
  if (hasComment) {
    opts.onCommentDeleteBlocked?.();
    return "handled";
  }

  const deletionMarkType = view.state.schema.marks["criticDeletion"];
  const insertionMarkType = view.state.schema.marks["criticInsertion"];
  if (!deletionMarkType) return "handled";
  if (rangeHasMark(view.state.doc, { from, to }, deletionMarkType)) {
    return "handled";
  }

  const ranges: Array<{ from: number; to: number; inserted: boolean }> = [];
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const textLen = node.text?.length ?? 0;
    const rangeFrom = Math.max(from, pos);
    const rangeTo = Math.min(to, pos + textLen);
    if (rangeFrom >= rangeTo) return false;
    ranges.push({
      from: rangeFrom,
      to: rangeTo,
      inserted: Boolean(insertionMarkType?.isInSet(node.marks)),
    });
    return false;
  });
  if (ranges.length === 0) return "handled";

  let tr = view.state.tr;
  for (const range of ranges) {
    const mappedFrom = tr.mapping.map(range.from, -1);
    const mappedTo = tr.mapping.map(range.to, 1);
    if (mappedFrom >= mappedTo) continue;
    if (range.inserted) {
      tr = tr.delete(mappedFrom, mappedTo);
    } else {
      tr = tr.addMark(mappedFrom, mappedTo, deletionMarkType.create());
    }
  }
  if (tr.steps.length === 0) return "handled";

  const collapsePos = Math.max(
    0,
    Math.min(tr.doc.content.size, tr.mapping.map(to, -1)),
  );
  tr = tr
    .setSelection(Selection.near(tr.doc.resolve(collapsePos), -1))
    .setMeta(AKAPEN_COMMAND_META, true);
  view.dispatch(tr.scrollIntoView());
  return "changed";
}

/**
 * 選択範囲の削除マーク（criticDeletion）を解除する。
 *
 * plan30 Phase 1: PM marks の removeMark で直接マークを剥がす。
 * v4 の OperationStore / delete-undo op は経由しない。
 *
 * 選択が空なら何もせず false。
 */
export function removeDeletionMark(ctx: CommandContext): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const { from, to, empty } = view.state.selection;
    if (empty) return false;
    const deletionMarkType = view.state.schema.marks["criticDeletion"];
    if (!deletionMarkType) return false;
    const structureRestores = findDeletionStructurePrefixRestores(
      view.state.doc,
      from,
      to,
      deletionMarkType,
    );
    let tr = view.state.tr.removeMark(from, to, deletionMarkType);
    const headingType = view.state.schema.nodes["heading"];
    for (const restore of structureRestores) {
      const mappedPrefixFrom = tr.mapping.map(restore.prefixFrom, -1);
      const mappedPrefixTo = tr.mapping.map(restore.prefixTo, 1);
      if (mappedPrefixFrom < mappedPrefixTo) {
        tr = tr.delete(mappedPrefixFrom, mappedPrefixTo);
      }
      if (restore.headingLevel && headingType) {
        const blockStart = tr.mapping.map(restore.blockStart, 1);
        const blockEnd = blockStart + restore.contentSize - restore.prefixLen;
        if (blockEnd >= blockStart) {
          tr = tr.setBlockType(blockStart, blockEnd, headingType, {
            level: restore.headingLevel,
          });
        }
      }
    }
    view.dispatch(tr);
    ctx.onEdited?.();
    return true;
  });
}

interface DeletionStructurePrefixRestore {
  blockStart: number;
  contentSize: number;
  prefixFrom: number;
  prefixTo: number;
  prefixLen: number;
  headingLevel: 1 | 2 | 3 | null;
}

function findDeletionStructurePrefixRestores(
  doc: PMNode,
  from: number,
  to: number,
  deletionMarkType: import("@milkdown/kit/prose/model").MarkType,
): DeletionStructurePrefixRestore[] {
  const restores: DeletionStructurePrefixRestore[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name !== "paragraph") return false;
    const prefix = markdownStructurePrefix(node.textContent);
    if (prefix === null) return false;
    const blockStart = pos + 1;
    const prefixFrom = blockStart;
    const prefixTo = blockStart + prefix.len;
    if (to <= prefixFrom || from >= prefixTo) return false;
    if (!rangeHasMark(doc, { from: prefixFrom, to: prefixTo }, deletionMarkType))
      return false;
    restores.push({
      blockStart,
      contentSize: node.content.size,
      prefixFrom,
      prefixTo,
      prefixLen: prefix.len,
      headingLevel: prefix.headingLevel,
    });
    return false;
  });
  return restores.sort((a, b) => b.prefixFrom - a.prefixFrom);
}

function markdownStructurePrefix(
  text: string,
): { len: number; headingLevel: 1 | 2 | 3 | null } | null {
  const heading = /^(#{1,3})\s+/.exec(text);
  if (heading) {
    return {
      len: heading[0].length,
      headingLevel: heading[1].length as 1 | 2 | 3,
    };
  }
  const bullet = /^[-*+]\s+/.exec(text);
  if (bullet) return { len: bullet[0].length, headingLevel: null };
  const ordered = /^\d+\.\s+/.exec(text);
  if (ordered) return { len: ordered[0].length, headingLevel: null };
  return null;
}

/**
 * PM doc 内で指定位置を含む criticComment mark の範囲を探す。
 * editComment / removeCommentMark の共通ヘルパ。
 */
function findCommentMarkRange(
  doc: PMNode,
  pos: number,
  commentType: import("@milkdown/kit/prose/model").MarkType,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.nodesBetween(0, doc.content.size, (node, nodePos) => {
    if (result) return false;
    if (
      node.isText &&
      commentType.isInSet(node.marks) &&
      nodePos <= pos &&
      pos < nodePos + node.nodeSize
    ) {
      let from = nodePos;
      let to = nodePos + node.nodeSize;
      doc.nodesBetween(
        Math.max(0, from - 1),
        Math.min(doc.content.size, to + 1),
        (n, p) => {
          if (
            n.isText &&
            commentType.isInSet(n.marks) &&
            (p + n.nodeSize === from || p === to)
          ) {
            if (p < from) from = p;
            if (p + n.nodeSize > to) to = p + n.nodeSize;
          }
          return true;
        },
      );
      result = { from, to };
    }
    return true;
  });
  return result;
}

/**
 * PM doc 内で criticComment range の直前にある criticHighlight mark の範囲を探す。
 * コメント削除時に highlight も一緒に剥がすためのヘルパ。
 */
function findHighlightBeforeComment(
  doc: PMNode,
  commentFrom: number,
  highlightType: import("@milkdown/kit/prose/model").MarkType,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.nodesBetween(0, commentFrom, (node, pos) => {
    if (
      node.isText &&
      highlightType.isInSet(node.marks) &&
      pos + node.nodeSize <= commentFrom
    ) {
      if (result === null || pos < result.from) {
        result = { from: pos, to: pos + node.nodeSize };
      } else if (pos + node.nodeSize > result.to) {
        result.to = pos + node.nodeSize;
      }
    }
    return true;
  });
  if (result && (result as { to: number }).to < commentFrom) {
    let to = (result as { to: number }).to;
    doc.nodesBetween(to, commentFrom, (n, p) => {
      if (n.isText && highlightType.isInSet(n.marks)) {
        to = p + n.nodeSize;
      }
      return true;
    });
    (result as { to: number }).to = to;
  }
  return result;
}

function findHighlightMarkRange(
  doc: PMNode,
  pos: number,
  highlightType: import("@milkdown/kit/prose/model").MarkType,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.nodesBetween(0, doc.content.size, (node, nodePos) => {
    if (result) return false;
    if (
      node.isText &&
      highlightType.isInSet(node.marks) &&
      nodePos <= pos &&
      pos < nodePos + node.nodeSize
    ) {
      let from = nodePos;
      let to = nodePos + node.nodeSize;
      doc.nodesBetween(0, doc.content.size, (n, p) => {
        if (!n.isText || !highlightType.isInSet(n.marks)) return true;
        if (p + n.nodeSize === from) from = p;
        if (p === to) to = p + n.nodeSize;
        return true;
      });
      result = { from, to };
    }
    return true;
  });
  return result;
}

function findCommentAfterHighlight(
  doc: PMNode,
  highlightTo: number,
  commentType: import("@milkdown/kit/prose/model").MarkType,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.nodesBetween(highlightTo, doc.content.size, (node, pos) => {
    if (result) return false;
    if (node.isText) {
      if (commentType.isInSet(node.marks)) {
        result = findCommentMarkRange(doc, pos, commentType);
      }
      return false;
    }
    return true;
  });
  return result;
}

function findCommentAtOrAfter(
  doc: PMNode,
  pos: number,
  commentType: import("@milkdown/kit/prose/model").MarkType,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  doc.nodesBetween(pos, doc.content.size, (node, nodePos) => {
    if (result) return false;
    if (node.isText && commentType.isInSet(node.marks)) {
      result = findCommentMarkRange(doc, Math.max(pos, nodePos), commentType);
      return false;
    }
    return true;
  });
  return result;
}

function rangeHasMark(
  doc: PMNode,
  range: { from: number; to: number },
  markType: import("@milkdown/kit/prose/model").MarkType,
): boolean {
  let found = false;
  doc.nodesBetween(range.from, range.to, (node) => {
    if (found) return false;
    if (node.isText && markType.isInSet(node.marks)) found = true;
    return true;
  });
  return found;
}

function rangeTouchesMark(
  doc: PMNode,
  range: { from: number; to: number },
  markType: import("@milkdown/kit/prose/model").MarkType,
): boolean {
  return rangeHasMark(
    doc,
    {
      from: Math.max(0, range.from - 1),
      to: Math.min(doc.content.size, range.to + 1),
    },
    markType,
  );
}

/**
 * コメント全体（highlight + instruction text）を削除する。
 *
 * plan30 Phase 2: PM marks を直接操作。
 * 1. commentEl（または選択範囲）から criticComment mark の範囲を特定
 * 2. その直前の criticHighlight mark を特定
 * 3. criticHighlight mark を剥がす
 * 4. criticComment テキストを物理削除
 */
export function removeCommentMark(
  ctx: CommandContext,
  opts?: { commentEl?: HTMLElement },
): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const commentType = view.state.schema.marks["criticComment"];
    const highlightType = view.state.schema.marks["criticHighlight"];
    if (!commentType || !highlightType) return false;

    let targetPos: number;
    if (opts?.commentEl) {
      targetPos = view.posAtDOM(opts.commentEl, 0);
    } else {
      const { from, empty } = view.state.selection;
      if (empty) return false;
      targetPos = from;
    }

    let cmRange = findCommentAtOrAfter(
      view.state.doc,
      targetPos,
      commentType,
    );
    const selectedHighlight = findHighlightMarkRange(
      view.state.doc,
      targetPos,
      highlightType,
    );
    if (!cmRange && selectedHighlight) {
      cmRange = findCommentAfterHighlight(
        view.state.doc,
        selectedHighlight.to,
        commentType,
      );
    }
    if (!cmRange) return false;

    const hlRange =
      selectedHighlight ??
      findHighlightBeforeComment(view.state.doc, cmRange.from, highlightType);

    let tr = view.state.tr;
    tr = tr.delete(cmRange.from, cmRange.to);
    if (hlRange) {
      tr = tr.removeMark(hlRange.from, hlRange.to, highlightType);
    }
    view.dispatch(tr.setMeta("akapen-skip-insertion", true));
    ctx.onEdited?.();
    return true;
  });
}

/**
 * コメントの指示文を書き換える。
 *
 * plan30 Phase 2: PM doc 内の criticComment テキストを直接差し替える。
 * commentEl から posAtDOM で位置を特定 → criticComment mark の範囲を取得 →
 * テキストを置換して criticComment mark を再付与。
 */
export function editComment(
  ctx: CommandContext,
  newInstruction: string,
  opts?: {
    commentEl?: HTMLElement;
    explicitRange?: { from: number; to: number };
  },
): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const commentType = view.state.schema.marks["criticComment"];
    const highlightType = view.state.schema.marks["criticHighlight"];
    if (!commentType) return false;

    let targetPos: number;
    if (opts?.commentEl) {
      targetPos = view.posAtDOM(opts.commentEl, 0);
    } else if (opts?.explicitRange) {
      targetPos = opts.explicitRange.from;
    } else {
      targetPos = view.state.selection.from;
    }

    let cmRange = findCommentAtOrAfter(
      view.state.doc,
      targetPos,
      commentType,
    );
    if (
      cmRange &&
      highlightType &&
      rangeHasMark(view.state.doc, cmRange, highlightType)
    ) {
      cmRange = findCommentAtOrAfter(
        view.state.doc,
        cmRange.to,
        commentType,
      );
    }
    if (!cmRange && highlightType) {
      const hlRange = findHighlightMarkRange(
        view.state.doc,
        targetPos,
        highlightType,
      );
      if (hlRange) {
        cmRange = findCommentAfterHighlight(
          view.state.doc,
          hlRange.to,
          commentType,
        );
      }
    }
    if (!cmRange) return false;

    const tr = view.state.tr
      .replaceWith(
        cmRange.from,
        cmRange.to,
        view.state.schema.text(newInstruction, [commentType.create()]),
      )
      .setMeta("akapen-skip-insertion", true);
    view.dispatch(tr);
    ctx.onEdited?.();
    return true;
  });
}

/**
 * 選択範囲にコメントを付ける。
 *
 * plan30 Phase 2: PM marks（criticHighlight + criticComment）を直接付与する。
 * 1. 選択範囲に criticHighlight mark を付ける
 * 2. 選択末尾に instruction テキストを挿入
 * 3. 挿入テキストに criticComment mark を付ける
 *
 * 見出しまたぎは PM doc から直接判定（座標変換不要）。
 * 選択が空 or 指示文が空なら何もせず false。
 */
export function applyComment(
  ctx: CommandContext,
  instruction: string,
): boolean {
  if (instruction.length === 0) return false;
  const { editor, onHeadingCrossed } = ctx;

  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const { from, to, empty } = view.state.selection;
    if (empty) return false;
    const deletionType = view.state.schema.marks["criticDeletion"];
    if (deletionType && rangeHasMark(view.state.doc, { from, to }, deletionType))
      return false;

    // 見出しまたぎ guard（PM doc から直接判定）
    if (onHeadingCrossed) {
      const trim = pmTrimSelectionByHeadings(view.state.doc, from, to);
      if (trim !== null) {
        onHeadingCrossed(trim);
        return false;
      }
    }

    const applied = dispatchComment(view, from, to, instruction);
    if (applied) ctx.onEdited?.();
    return applied;
  });
}

/**
 * PM doc の [from, to) 範囲に見出し node が含まれるかを判定し、
 * 含まれる場合は TrimResult を返す。含まれなければ null。
 */
function pmTrimSelectionByHeadings(
  doc: PMNode,
  from: number,
  to: number,
): TrimResult | null {
  const headingSpans: Array<{ start: number; end: number }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "heading") {
      headingSpans.push({ start: pos, end: pos + node.nodeSize });
      return false;
    }
    return true;
  });
  if (headingSpans.length === 0) return null;

  const segments: Array<{ from: number; to: number }> = [];
  let cursor = from;
  for (const span of headingSpans) {
    if (span.start > cursor) {
      const trimmed = trimPmTextSegment(doc, cursor, span.start);
      if (trimmed) segments.push(trimmed);
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < to) {
    const trimmed = trimPmTextSegment(doc, cursor, to);
    if (trimmed) segments.push(trimmed);
  }

  if (segments.length === 0) return { kind: "empty" };
  if (segments.length === 1)
    return { kind: "single", from: segments[0].from, to: segments[0].to };
  return { kind: "multiple", segments };
}

function trimPmTextSegment(
  doc: PMNode,
  from: number,
  to: number,
): { from: number; to: number } | null {
  let first: number | null = null;
  let last: number | null = null;

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? "";
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const startOffset = Math.max(0, start - pos);
    const endOffset = Math.min(text.length, end - pos);

    for (let i = startOffset; i < endOffset; i += 1) {
      if (!isTrimChar(text[i])) {
        if (first === null) first = pos + i;
        break;
      }
    }
    for (let i = endOffset - 1; i >= startOffset; i -= 1) {
      if (!isTrimChar(text[i])) {
        last = Math.max(last ?? -1, pos + i);
        break;
      }
    }
    return true;
  });

  if (first === null || last === null || last < first) return null;
  return { from: first, to: last + 1 };
}

/**
 * PM transaction で highlight + instruction text + comment mark を付与する共通ヘルパ。
 * applyComment / applyCommentAtRange から呼ぶ。
 */
function dispatchComment(
  view: import("@milkdown/kit/prose/view").EditorView,
  from: number,
  to: number,
  instruction: string,
): boolean {
  const highlightType = view.state.schema.marks["criticHighlight"];
  const commentType = view.state.schema.marks["criticComment"];
  const deletionType = view.state.schema.marks["criticDeletion"];
  const insertionType = view.state.schema.marks["criticInsertion"];
  if (!highlightType || !commentType) return false;
  if (deletionType && rangeHasMark(view.state.doc, { from, to }, deletionType))
    return false;
  if (insertionType && rangeHasMark(view.state.doc, { from, to }, insertionType))
    return false;
  if (rangeTouchesMark(view.state.doc, { from, to }, highlightType))
    return false;
  if (rangeTouchesMark(view.state.doc, { from, to }, commentType))
    return false;

  const tr = view.state.tr
    .addMark(from, to, highlightType.create())
    .insertText(instruction, to)
    .addMark(to, to + instruction.length, commentType.create())
    .setMeta("akapen-skip-insertion", true);
  view.dispatch(tr);
  return true;
}

/**
 * plan20 T10: PM 側 heading 検出時、baseRaw 範囲が `# ` プレフィックスを含まないケースで
 * trim 判定が正しく empty/single になるように範囲を行頭・行末まで広げる。
 *
 * - from を行頭まで遡る（lastIndexOf('\n', from-1) + 1）
 * - to を次の `\n` 直後まで進める（indexOf('\n', to-1) + 1・無ければ末尾）
 *
 * これで PM coord undercount で `# ` を取りこぼした range も、widened 範囲なら
 * `/^#{1,6} /` パターンが trim の見出し行スパン抽出に乗る。
 *
 * 単体テスト目的で export（applyComment の挙動を直接テストするには Milkdown Editor の
 * mock が必要なため、まずは純関数を切り出して検証する）。
 */
export function widenRangeToHeadingLineEdges(
  baseRaw: string,
  from: number,
  to: number,
): { from: number; to: number } {
  const lineStart = from <= 0 ? 0 : baseRaw.lastIndexOf("\n", from - 1) + 1;
  const nl = baseRaw.indexOf("\n", Math.max(to - 1, 0));
  const lineEnd = nl === -1 ? baseRaw.length : nl + 1;
  return { from: lineStart, to: lineEnd };
}

/**
 * trim 範囲で直接コメントを付ける低レベル経路。
 *
 * `applyComment` の onHeadingCrossed 経由で「OK」が選ばれた後の **再呼び出し用**。
 * PM 座標を直接受け取って highlight + comment marks を付与する。
 *
 * plan30 Phase 2: PM marks を直接操作（v4 の OperationStore 経由を廃止）。
 */
export function applyCommentAtRange(
  ctx: CommandContext,
  instruction: string,
  trimmedRange: { from: number; to: number },
): boolean {
  if (instruction.length === 0) return false;
  if (trimmedRange.to <= trimmedRange.from) return false;
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const applied = dispatchComment(
      view,
      trimmedRange.from,
      trimmedRange.to,
      instruction,
    );
    if (applied) ctx.onEdited?.();
    return applied;
  });
}

// ---------------------------------------------------------------------------
// F8 整形コマンド（plan30 v5: PM commands 直接操作）
// ---------------------------------------------------------------------------

function rangeHasTextMark(
  doc: PMNode,
  from: number,
  to: number,
  markType: MarkType | undefined,
): boolean {
  if (!markType || to <= from) return false;
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (node.isText && markType.isInSet(node.marks)) found = true;
    return true;
  });
  return found;
}

function selectionTouchesDeletionMark(
  doc: PMNode,
  from: number,
  to: number,
  deletionMarkType: MarkType | undefined,
): boolean {
  return rangeHasTextMark(doc, from, to, deletionMarkType);
}

/**
 * F8: 見出し（H1〜H3）をトグルする。
 * plan30 v5: PM の setBlockType で heading ↔ paragraph を直接切り替える。
 */
export function applyHeading(ctx: CommandContext, level: 1 | 2 | 3): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const { from, to } = view.state.selection;
    const headingType = view.state.schema.nodes["heading"];
    const paragraphType = view.state.schema.nodes["paragraph"];
    const deletionMarkType = view.state.schema.marks["criticDeletion"];
    if (!headingType || !paragraphType) return false;
    if (
      selectionTouchesDeletionMark(
        view.state.doc,
        from,
        to,
        deletionMarkType,
      )
    )
      return false;

    const $from = view.state.selection.$from;
    const parent = $from.parent;

    if (parent.type === headingType && parent.attrs.level === level) {
      view.dispatch(view.state.tr.setBlockType(from, to, paragraphType));
    } else {
      view.dispatch(
        view.state.tr.setBlockType(from, to, headingType, { level }),
      );
    }
    return true;
  });
}

/**
 * F8: 選択範囲の太字をトグルする。
 * plan30 v5: PM の toggleMark / removeMark で strong を直接操作する。
 * `unboldOnly` が true なら unbold のみ試行し bold 追加はしない。
 */
export function toggleBold(ctx: CommandContext, unboldOnly = false): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const strongType = view.state.schema.marks["strong"];
    const deletionMarkType = view.state.schema.marks["criticDeletion"];
    if (!strongType) return false;
    if (view.state.selection.empty) return false;
    if (
      selectionTouchesDeletionMark(
        view.state.doc,
        view.state.selection.from,
        view.state.selection.to,
        deletionMarkType,
      )
    )
      return false;

    if (unboldOnly) {
      const { from, to } = view.state.selection;
      let hasStrong = false;
      view.state.doc.nodesBetween(from, to, (node) => {
        if (node.isText && strongType.isInSet(node.marks)) hasStrong = true;
        return !hasStrong;
      });
      if (!hasStrong) return false;
      view.dispatch(view.state.tr.removeMark(from, to, strongType));
      return true;
    }

    return pmToggleMark(strongType)(view.state, view.dispatch);
  });
}

/**
 * F8: 選択ブロックを箇条書きにする。
 * plan30 v5: PM の wrapInList で bullet_list を直接適用する。
 */
export function applyBulletList(ctx: CommandContext): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const bulletListType = view.state.schema.nodes["bullet_list"];
    const deletionMarkType = view.state.schema.marks["criticDeletion"];
    if (!bulletListType) return false;
    if (
      selectionTouchesDeletionMark(
        view.state.doc,
        view.state.selection.from,
        view.state.selection.to,
        deletionMarkType,
      )
    )
      return false;
    return pmWrapInList(bulletListType)(view.state, view.dispatch);
  });
}

// ---------------------------------------------------------------------------
// 旧シグネチャ用のコンテキスト判定ヘルパ
// ---------------------------------------------------------------------------

/**
 * 選択範囲に criticComment mark が含まれるかを判定する。
 * app.ts の getMarkContext で「コメント削除」ボタンの可視性切り替えに使う。
 *
 * plan30 Phase 2: PM marks を直接走査する（v4 の operations 逆引きを廃止）。
 */
export function selectionHasCommentMark(ctx: CommandContext): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const { from, to, empty } = view.state.selection;
    if (empty) return false;
    const commentMarkType = view.state.schema.marks["criticComment"];
    const highlightMarkType = view.state.schema.marks["criticHighlight"];
    if (!commentMarkType && !highlightMarkType) return false;
    let found = false;
    view.state.doc.nodesBetween(
      Math.max(0, from - 1),
      Math.min(view.state.doc.content.size, to + 1),
      (node) => {
        if (found) return false;
        if (node.isText) {
          if (commentMarkType && commentMarkType.isInSet(node.marks))
            found = true;
          if (highlightMarkType && highlightMarkType.isInSet(node.marks))
            found = true;
        }
        return true;
      },
    );
    return found;
  });
}

/**
 * 選択範囲に criticDeletion mark が含まれるかを判定する。
 * app.ts の getMarkContext で「削除解除」ボタンの可視性切り替えに使う。
 *
 * plan30 Phase 1: PM marks を直接走査する（v4 の operations 逆引きを廃止）。
 */
export function selectionHasDeletionMark(ctx: CommandContext): boolean {
  const { editor } = ctx;
  return editor.action((c) => {
    const view = c.get(editorViewCtx);
    const { from, to, empty } = view.state.selection;
    if (empty) return false;
    const deletionMarkType = view.state.schema.marks["criticDeletion"];
    if (!deletionMarkType) return false;
    let found = false;
    view.state.doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      if (node.isText && deletionMarkType.isInSet(node.marks)) {
        found = true;
      }
      return true;
    });
    return found;
  });
}

// ---------------------------------------------------------------------------
// 後方互換シム（plan15 C-2 由来・T15.5b で撤去予定）
// ---------------------------------------------------------------------------

/**
 * 後方互換シム: `removeDeletionMark` に委譲する。
 *
 * @deprecated plan15 で removeDeletionMark / removeCommentMark に分離・
 *   T15.5b で app.ts / shortcuts を新 API に揃えた後にこのシムを削除すること。
 */
export const removeCriticMarks = removeDeletionMark;
