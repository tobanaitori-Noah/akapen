/**
 * 原文モード（CodeMirror 6）のソースエディター＝計画2 Task 5 Step 3。
 *
 * 定型構成: EditorView＋EditorState.create＋（旧 minimalSetup 相当の手作り extension 集合）
 * ＋@codemirror/lang-markdown＋EditorView.lineWrapping＋updateListener（docChanged 時に
 * 文字列を通知）。plan18 T13.5 で minimalSetup は使わず分解（history / historyKeymap 除外）。
 * readOnly は EditorState.readOnly.of(true)（コマンド層）＋EditorView.editable.of(false)
 * （DOM 層＝contenteditable 無効）の併用。
 *
 * 削除マーク内編集の禁止（原文モードのガード）:
 * EditorState.changeFilter で、変更範囲が findCriticTokens の `{--…--}` トークン範囲
 * （区切り含む内側）に掛かるトランザクションの変更を拒否する。トークン範囲は
 * startState.doc 単位で再計算（数千〜1万字なら十分軽い）。これで preview
 * （insertion-on-type 宿題④）と source の両モードで削除マーク内編集が禁止される。
 *
 * v1.1 F6（赤ペン化）: 区切り記号は source-redpen.ts の装飾で画面から隠れるため、
 * 削除以外のトークン（{++ ++}/{== ==}/{>> <<}）も両端の区切り3文字を changeFilter で
 * 保護する（見えない記号の部分破壊＝沈黙のデータ破損を防ぐ）。トークン全体を覆う
 * 範囲変更だけは許可＝マーク丸ごとの削除・置換は今までどおりできる。中身の編集も
 * 従来どおり自由（削除マークだけは v1 から全範囲拒否のまま維持）。
 * 使用 API の確認記録は docs/implementation-notes.md（Task 5・v1.1 F6）。
 */
import { findCriticTokens } from '@akapen/markup';
// plan18 T13.5: CodeMirror 内蔵 history / historyKeymap を取り外し、Cmd+Z / Cmd+Shift+Z は
// app.ts のショートカット配線（OperationStore.undo / redo）に統一する。
// minimalSetup（codemirror パッケージが束ねていた basic set）は history を含むため**使わず**、
// 自前で最小拡張集合を構築する：
//   - drawSelection / defaultHighlightStyle: minimalSetup 由来の基本表示
//   - history / historyKeymap: 取り外し（権威は OperationStore）
//   - defaultKeymap: 文字入力・選択移動の基本は維持（historyKeymap だけ抜く）
// 旧 import `redo / redoDepth / undo / undoDepth` も削除（公開 API は no-op 化）。
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension, Text } from '@codemirror/state';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { redPenView } from './source-redpen';
import { sourceCommentDecorationExtension } from './source-comment-decoration';
import './critic.css';

export interface SourceEditorOptions {
  /** マウント先（この要素の子として CM6 が DOM を生やす） */
  parent: HTMLElement;
  /** 初期テキスト（CriticMarkup 入り md） */
  doc: string;
  /** 読み取り専用（左ペイン＝ベース表示用） */
  readOnly?: boolean;
  /** doc が変わるたびに呼ばれる（state.workingMd の即時更新用） */
  onDocChanged?: (doc: string) => void;
  /** G5: 行整列エクステンション（createAlignmentExtension() の戻り値から渡す） */
  alignmentExtension?: import('@codemirror/state').Extension;
  /** J9: 動的ショートカット keymap 用 extension */
  shortcutExtension?: import('@codemirror/state').Extension;
  /** コメント範囲を含む削除・置換をブロックした時の通知 */
  onCommentDeleteBlocked?: () => void;
}

export interface SourceEditorHandle {
  view: EditorView;
  getText(): string;
  /** 全置換（モード切替の流し込み。アプリ自身の同期＝changeFilter を素通しする） */
  setText(text: string): void;
  undo(): boolean;
  redo(): boolean;
  undoDepth(): number;
  redoDepth(): number;
  /** 現在の doc/extensions で EditorState を作り直し、履歴だけ空にする */
  clearHistory(): void;
  setShortcutExtension(extension: Extension): void;
  destroy(): void;
}

interface GuardRange {
  from: number;
  to: number;
  /** 所属トークンの全範囲（allowFullCover の判定に使う） */
  tokenFrom: number;
  tokenTo: number;
  /** トークン全体を覆う範囲変更なら許可（F6: 区切り保護はマーク丸ごと削除を妨げない） */
  allowFullCover: boolean;
}

/** {>>…<<} コメント内に混入禁止の文字列パターン（CriticMarkup 記号・改行） */
const COMMENT_FORBIDDEN_RE = /\{--|--\}|\{\+\+|\+\+\}|\{==|==\}|\{>>|<<\}|\n/;

/**
 * doc（startState 単位）の保護範囲を返す（doc が変わった時だけ再計算）。
 * - {--…--}: 部分編集は拒否。トークン全体を覆う変更は、広範囲 source 削除を
 *   preview に戻すため許可する。
 * - {++ ++}: 両端の区切り3文字だけ保護（F6: 画面から隠れるため）。
 *   トークン全体を覆う変更は許可・中身の編集は従来どおり自由。
 * - {== ==}: 両端の区切り3文字＋内側コンテンツ全体をブロック（H2 修正 v1.2）。
 *   highlight 内への入力は reconcile の整合性を壊す＝typing 禁止。
 *   トークン全体を覆う変更（丸ごと削除・置換）は許可。
 * - {>> <<}: 両端の区切り3文字はブロック。内側は criticGuard で別処理
 *   （CriticMarkup 記号・改行の混入のみ拒否・通常テキスト入力は許可）。
 */
function createGuardRangeCache(): (doc: Text) => {
  ranges: GuardRange[];
  commentRanges: Array<{ from: number; to: number; tokenFrom: number; tokenTo: number }>;
  commentTokenRanges: Array<{ from: number; to: number }>;
} {
  let cachedDoc: Text | null = null;
  let cachedRanges: GuardRange[] = [];
  let cachedCommentRanges: Array<{ from: number; to: number; tokenFrom: number; tokenTo: number }> = [];
  let cachedCommentTokenRanges: Array<{ from: number; to: number }> = [];
  return (doc) => {
    if (doc !== cachedDoc) {
      cachedDoc = doc;
      cachedRanges = [];
      cachedCommentRanges = [];
      cachedCommentTokenRanges = [];
      for (const hit of findCriticTokens(doc.toString())) {
        const from = hit.index;
        const to = hit.index + hit.token.length;
        if (hit.token.startsWith('{--')) {
          // deletion: 部分編集は拒否、トークン全体を含む広範囲削除は許可。
          cachedRanges.push({ from, to, tokenFrom: from, tokenTo: to, allowFullCover: true });
        } else if (hit.token.startsWith('{++')) {
          // insertion: 区切り3文字だけ保護・中身は自由
          cachedRanges.push(
            { from, to: from + 3, tokenFrom: from, tokenTo: to, allowFullCover: true },
            { from: to - 3, to, tokenFrom: from, tokenTo: to, allowFullCover: true },
          );
        } else if (hit.token.startsWith('{==')) {
          cachedCommentTokenRanges.push({ from, to });
          // highlight: 区切り3文字＋内側コンテンツ全体をブロック（H2 修正）
          // 内側: from+3 ～ to-3（中身への typing を拒否し reconcile 整合性を守る）
          cachedRanges.push(
            { from, to: from + 3, tokenFrom: from, tokenTo: to, allowFullCover: false },
            { from: from + 3, to: to - 3, tokenFrom: from, tokenTo: to, allowFullCover: false },
            { from: to - 3, to, tokenFrom: from, tokenTo: to, allowFullCover: false },
          );
        } else if (hit.token.startsWith('{>>')) {
          cachedCommentTokenRanges.push({ from, to });
          // comment: 区切り3文字はブロック・内側は別処理（COMMENT_FORBIDDEN_RE で判定）
          cachedRanges.push(
            { from, to: from + 3, tokenFrom: from, tokenTo: to, allowFullCover: false },
            { from: to - 3, to, tokenFrom: from, tokenTo: to, allowFullCover: false },
          );
          // 内側範囲をコメントガード用リストに登録
          if (to - 3 > from + 3) {
            cachedCommentRanges.push({ from: from + 3, to: to - 3, tokenFrom: from, tokenTo: to });
          }
        }
      }
    }
    return {
      ranges: cachedRanges,
      commentRanges: cachedCommentRanges,
      commentTokenRanges: cachedCommentTokenRanges,
    };
  };
}

export function createSourceEditor(options: SourceEditorOptions): SourceEditorHandle {
  const {
    parent,
    doc,
    readOnly = false,
    onDocChanged,
    alignmentExtension,
    shortcutExtension,
    onCommentDeleteBlocked,
  } = options;
  const guardRangesOf = createGuardRangeCache();
  const shortcutCompartment = new Compartment();
  let currentShortcutExtension: Extension = shortcutExtension ?? [];

  // 削除マーク {--…--} 内（区切り含む）＋他トークンの区切り3文字（F6）に掛かる変更を
  // 拒否する changeFilter。挿入（fromA === toA）は境界ちょうど（範囲の直前・直後）なら
  // 外側＝許可。範囲編集は保護範囲と少しでも重なれば拒否（削除マークはトークン全体を
  // 覆う削除も含む）。ただし allowFullCover の範囲はトークン全体を覆う変更なら許可。
  //
  // H2 修正（v1.2）: {== ==} 内側コンテンツもブロック対象に追加（区切り3文字と同扱い）。
  //   {>> <<} 内側は通常テキスト入力を許可するが CriticMarkup 記号・改行の混入は拒否する。
  const criticGuard = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged) return true;
    const { ranges, commentRanges, commentTokenRanges } = guardRangesOf(tr.startState.doc);
    let blocked = false;
    let blockedCommentDelete = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (blocked) return;
      const isDeletionOrReplace = fromA < toA;
      const insertedText = inserted.toString();
      if (isDeletionOrReplace) {
        for (const cr of commentTokenRanges) {
          if (fromA < cr.to && toA > cr.from) {
            blocked = true;
            blockedCommentDelete = true;
            return;
          }
        }
      }
      // 通常ガード範囲チェック
      for (const range of ranges) {
        const touches =
          fromA === toA
            ? fromA > range.from && fromA < range.to
            : fromA < range.to && toA > range.from;
        if (!touches) continue;
        if (range.allowFullCover && fromA <= range.tokenFrom && toA >= range.tokenTo) continue;
        blocked = true;
        if (range.tokenFrom < range.tokenTo) {
          blockedCommentDelete = commentTokenRanges.some(
            (cr) => range.tokenFrom === cr.from && range.tokenTo === cr.to,
          );
        }
        return;
      }
      // コメント内ガード: CriticMarkup 記号・改行の混入のみ拒否
      if (!blocked && commentRanges.length > 0) {
        if (COMMENT_FORBIDDEN_RE.test(insertedText)) {
          for (const cr of commentRanges) {
            // 挿入点がコメント内にある（境界も含む）か、削除範囲がコメント内に掛かるか
            const inRange =
              fromA === toA
                ? fromA >= cr.from && fromA <= cr.to
                : fromA < cr.to && toA > cr.from;
            if (inRange) {
              blocked = true;
              blockedCommentDelete = true;
              return;
            }
          }
        }
      }
    });
    if (blockedCommentDelete) onCommentDeleteBlocked?.();
    return !blocked;
  });

  const buildExtensions = (): Extension[] => {
    // plan18 T13.5: minimalSetup を分解。codemirror パッケージの minimalSetup は
    //   highlightSpecialChars() / history() / drawSelection() /
    //   syntaxHighlighting(defaultHighlightStyle, { fallback: true }) /
    //   keymap.of([...defaultKeymap, ...historyKeymap])
    // を束ねている。Cmd+Z 系は OperationStore に統一するため history と historyKeymap を
    // 除外して再構築する。highlightSpecialChars は Unicode 改行（U+2028 等）を
    // Decoration.replace し得るため source 本文では外す（本文文字として保持する）。
    // defaultKeymap は文字入力・選択移動の基礎なので保持・Cmd+Z は shortcutCompartment 側で
    // Prec.highest に積まれた OperationStore 配線が先に走る。
    const extensions: Extension[] = [
      drawSelection(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of(defaultKeymap),
      markdown(),
      EditorView.lineWrapping,
      lineNumbers(), // G5: 行番号表示
      criticGuard,
      redPenView(), // F6: 記法記号を隠して赤ペン表示（表示専用・doc は生記法のまま）
      // plan20 T14（HLD v3 §5.6）: コメント `{==…==}{>>…<<}` を preview と同じ
      //   「蛍光ペン + ホバー popup」に畳む。redPenView は highlight/comment を扱わなくなる
      //   ため、本プラグインが「装飾＋hover target の DOM 化」を一手に担う。
      sourceCommentDecorationExtension(),
      shortcutCompartment.of(currentShortcutExtension),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onDocChanged) onDocChanged(update.state.doc.toString());
      }),
    ];
    if (alignmentExtension) {
      // S6-5 / S7-4: alignment wiring 契約強化。createAlignmentExtension() の baseExtension /
      // workingExtension のいずれかであることを呼び出し境界で runtime assert する。
      // Extension は配列 or StateField 等の union だが、少なくとも truthy かつオブジェクト型
      // であることを確認し、原始型（文字列・数値）を誤渡しした場合に即検知する。
      // S7-4: `typeof null === 'object'` の JavaScript 仕様上の挙動により、S6-5 実装では null が
      // 渡された場合も第1条件（typeof !== 'object'）が false になり throw が飛ばない抜け穴があった。
      // `|| alignmentExtension === null` を追加して null を明示的に弾く。
      // ⚠️ 現在の呼び出しパス（app.ts で `alignmentExtension` を TS 型 Extension で宣言）では
      // null は未到達だが、将来の呼び出し元追加時の防衛として明示的に追加する。
      // S7-6 INFO: `&& !Array.isArray(alignmentExtension)` を AND 連結している理由：
      // CodeMirror の Extension 型は Extension[] の配列も有効（複数 Extension のまとめ渡し）。
      // typeof 配列 === 'object' かつ !null なので第1条件のみでは配列を弾かない設計が正しい。
      // Array.isArray チェックは「原始型や null を throw させるが配列は通す」という正確な意図。
      // simplify（条件を1つにまとめる）すると配列を誤って弾くリスクがあるためこの形を維持する。
      if ((typeof alignmentExtension !== 'object' || alignmentExtension === null) && !Array.isArray(alignmentExtension)) {
        throw new Error('[akapen] codemirror: alignmentExtension に無効な値が渡されました（createAlignmentExtension() の戻り値を使用してください）');
      }
      extensions.push(alignmentExtension); // G5: 行整列デコレーション
    }
    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    }
    return extensions;
  };

  const view = new EditorView({
    state: EditorState.create({ doc, extensions: buildExtensions() }),
    parent,
  });

  return {
    view,
    getText: () => view.state.doc.toString(),
    setText: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        filter: false,
        annotations: Transaction.addToHistory.of(false),
      });
    },
    // plan18 T13.5: CM6 内蔵 history は外したので公開 API は no-op 化。
    // Cmd+Z / Cmd+Shift+Z は app.ts のショートカット配線（OperationStore.undo / redo）へ統一。
    // 既存呼び出し元（app.ts の clearHistory 呼び出し 3 箇所など）の互換のために残すが
    // 実体は何もしない（権威は OperationStore＝自前 stack が真実源）。
    undo: () => false,
    redo: () => false,
    undoDepth: () => 0,
    redoDepth: () => 0,
    clearHistory: () => {
      /* no-op: history は OperationStore が真実源 */
    },
    setShortcutExtension: (extension) => {
      currentShortcutExtension = extension;
      view.dispatch({
        effects: shortcutCompartment.reconfigure(extension),
        annotations: Transaction.addToHistory.of(false),
      });
    },
    destroy: () => {
      view.destroy();
    },
  };
}
