/**
 * F6: 原文モード（CM6）の赤ペン化（v1.1）。
 *
 * 表示: CriticMarkup の区切り記号（{-- --} / {++ ++} / {== ==} / {>> <<}）を
 * Decoration.replace で隠す。削除は token 全体を非表示にし、追記は本文だけを通常文字として表示する。
 * 装飾は表示層だけ＝doc（workingMd に流れるデータ）は生記法のまま一切変えない。
 * 隠した区切りは EditorView.atomicRanges でカーソル移動の単位にする
 * （見えない3文字の中へキャレットが入り込まない）。区切りの編集保護は
 * codemirror.ts の changeFilter（F6 拡張）が担う＝表示と保護で層を分ける。
 *
 * 操作: applySourceDeletion / applySourceComment（選択ポップオーバーの source 経路）。
 * 記法文字列を doc に挿入する＝preview の addMark と同等の「データに記法が入る」
 * 正規の編集（表示目的の文字ではない）。既存トークンと交差する選択は no-op
 * （入れ子記法＝parse 不能データを作らない）。
 * 使用 API の確認記録は docs/implementation-notes.md（v1.1 F6）。
 */
import { findCriticTokens } from "@akapen/markup";
import type { Extension, Range, Text } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

const KIND_BY_OPEN: Record<
  string,
  "deletion" | "insertion" | "comment" | "highlight"
> = {
  "{--": "deletion",
  "{++": "insertion",
  "{>>": "comment",
  "{==": "highlight",
};

/** 区切り/削除 token を隠す（doc には残る＝表示だけ消える） */
const hideDelimiter = Decoration.mark({ class: "cm-critic-hidden" });

function pushReplaceRange(
  ranges: Range<Decoration>[],
  doc: Text,
  from: number,
  to: number,
): void {
  let start = from;
  while (start < to) {
    const line = doc.lineAt(start);
    if (start >= line.to && line.number < doc.lines) {
      start = doc.line(line.number + 1).from;
      continue;
    }
    const end = Math.min(to, line.to);
    if (end > start) ranges.push(hideDelimiter.range(start, end));
    if (end >= to) break;
    if (line.number >= doc.lines) break;
    start = doc.line(line.number + 1).from;
  }
}

function buildRedPen(doc: Text): { all: DecorationSet; hidden: DecorationSet } {
  const all: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const src = doc.toString();
  // plan20 T14: highlight / comment（`{==…==}` + `{>>…<<}` ペア）は
  //   source-comment-decoration.ts が「蛍光ペン + ホバー popup」へ畳むため
  //   ここでは触らない（HLD v3 §5.6・divergence を作らないために 1 経路に統合）。
  //   ペアでない孤立 highlight / comment（owner ワークフロー想定外＝手書き混入など）も
  //   silent corruption を避けるため装飾せず literal で見せる（HLD v3 §5.6 末尾）。
  for (const hit of findCriticTokens(src)) {
    const kind = KIND_BY_OPEN[hit.token.slice(0, 3)];
    if (!kind) continue; // findCriticTokens は4記法しか返さない（防衛）
    if (kind === "highlight" || kind === "comment") continue; // plan20 T14: 装飾は別プラグインに移管
    const from = hit.index;
    const to = from + hit.token.length;
    if (kind === "deletion") {
      // トークン全体（区切り＋内容）を非表示にする。
      // CM6 バッファは生記法のまま保持し、表示層だけ完全に隠す。
      // 改行を含む削除は Decoration.replace が跨げないため行単位に分割。
      pushReplaceRange(all, doc, from, to);
      pushReplaceRange(hidden, doc, from, to);
    } else if (kind === "insertion") {
      pushReplaceRange(all, doc, from, from + 3);
      pushReplaceRange(hidden, doc, from, from + 3);
      pushReplaceRange(all, doc, to - 3, to);
      pushReplaceRange(hidden, doc, to - 3, to);
    } else {
      pushReplaceRange(all, doc, from, from + 3);
      pushReplaceRange(hidden, doc, from, from + 3);
      if (from + 3 < to - 3) {
        all.push(
          Decoration.mark({ class: `cm-critic-${kind}` }).range(
            from + 3,
            to - 3,
          ),
        );
      }
      pushReplaceRange(all, doc, to - 3, to);
      pushReplaceRange(hidden, doc, to - 3, to);
    }
  }
  return { all: Decoration.set(all), hidden: Decoration.set(hidden) };
}

const redPenPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: DecorationSet;
    constructor(view: EditorView) {
      const built = buildRedPen(view.state.doc);
      this.decorations = built.all;
      this.hidden = built.hidden;
    }
    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      const built = buildRedPen(update.state.doc);
      this.decorations = built.all;
      this.hidden = built.hidden;
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.hidden ?? Decoration.none,
      ),
  },
);

/** 原文モードの赤ペン表示拡張（表示専用＝doc は生記法のまま） */
export function redPenView(): Extension {
  return redPenPlugin;
}

/** 選択範囲が既存トークン（区切り含む）と少しでも重なるか */
function overlapsToken(doc: Text, from: number, to: number): boolean {
  return findCriticTokens(doc.toString()).some(
    (hit) => from < hit.index + hit.token.length && to > hit.index,
  );
}

/** 原文モード: 選択範囲を通常削除する。source→preview commit が削除 annotation 化する。 */
export function applySourceDeletion(view: EditorView): boolean {
  const { from, to, empty } = view.state.selection.main;
  if (empty || overlapsToken(view.state.doc, from, to)) return false;
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
  });
  return true;
}

/**
 * 原文モード: 選択範囲にコメント＝{==選択==}{>>指示<<}（preview の applyComment と同じ結果形）。
 * 選択が空・指示文が空・トークン交差は no-op。
 */
export function applySourceComment(
  view: EditorView,
  instruction: string,
): boolean {
  const { from, to, empty } = view.state.selection.main;
  if (
    empty ||
    instruction.length === 0 ||
    overlapsToken(view.state.doc, from, to)
  ) {
    return false;
  }
  const tail = `==}{>>${instruction}<<}`;
  view.dispatch({
    changes: [
      { from, insert: "{==" },
      { from: to, insert: tail },
    ],
    selection: { anchor: to + "{==".length + tail.length },
  });
  return true;
}

// ---------------------------------------------------------------------------
// 見出しまたぎ判定 + source コメント guard（旧 source-edit-bridge.ts / commands.ts から移動）
// ---------------------------------------------------------------------------

/** TrimResult: 見出しまたぎ判定の結果型 */
export type TrimResult =
  | { kind: "single"; from: number; to: number }
  | { kind: "multiple"; segments: Array<{ from: number; to: number }> }
  | { kind: "empty" };

function isTrimChar(c: string): boolean {
  return c === "\n" || c === "\r" || c === " " || c === "\t";
}

function trimSegment(
  text: string,
  from: number,
  to: number,
): { from: number; to: number } | null {
  let a = from;
  let b = to;
  while (a < b && isTrimChar(text[a])) a++;
  while (b > a && isTrimChar(text[b - 1])) b--;
  if (a >= b) return null;
  return { from: a, to: b };
}

function matchesHeadingPrefix(text: string, p: number): boolean {
  let i = p;
  let hashCount = 0;
  while (i < text.length && text[i] === "#") {
    hashCount++;
    i++;
    if (hashCount > 6) return false;
  }
  if (hashCount < 1 || hashCount > 6) return false;
  return text[i] === " ";
}

/**
 * 選択範囲 [from, to) が text 上で見出し行（`/^#{1,6} /`）をまたぐかを判定する。
 */
function selectionCrossesHeading(
  text: string,
  from: number,
  to: number,
): boolean {
  if (from < 0 || to > text.length || from >= to) return false;
  for (let p = from; p < to; p++) {
    const isLineStart = p === 0 || text[p - 1] === "\n";
    if (!isLineStart) continue;
    if (matchesHeadingPrefix(text, p)) return true;
  }
  return false;
}

/**
 * 選択範囲 [from, to) から見出し行を除いた本文範囲を返す。
 */
function trimSelectionByHeadings(
  text: string,
  from: number,
  to: number,
): TrimResult {
  if (from < 0 || to > text.length || from >= to) return { kind: "empty" };

  type Span = { start: number; end: number };
  const headingSpans: Span[] = [];
  for (let p = from; p < to; p++) {
    const isLineStart = p === 0 || text[p - 1] === "\n";
    if (!isLineStart) continue;
    if (!matchesHeadingPrefix(text, p)) continue;
    const nl = text.indexOf("\n", p);
    const hStart = p;
    const hEnd = nl === -1 ? text.length : nl + 1;
    headingSpans.push({ start: hStart, end: hEnd });
    p = hEnd - 1;
  }

  if (headingSpans.length === 0) {
    const trimmed = trimSegment(text, from, to);
    if (trimmed === null) return { kind: "empty" };
    return { kind: "single", from: trimmed.from, to: trimmed.to };
  }

  const segments: Array<{ from: number; to: number }> = [];
  let cursor = from;
  for (const span of headingSpans) {
    const segStart = cursor;
    const segEnd = Math.min(span.start, to);
    if (segEnd > segStart) {
      const trimmed = trimSegment(text, segStart, segEnd);
      if (trimmed !== null) segments.push(trimmed);
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < to) {
    const trimmed = trimSegment(text, cursor, to);
    if (trimmed !== null) segments.push(trimmed);
  }

  if (segments.length === 0) return { kind: "empty" };
  if (segments.length === 1) {
    return { kind: "single", from: segments[0].from, to: segments[0].to };
  }
  return { kind: "multiple", segments };
}

/**
 * source モード: 見出しまたぎ guard 付きコメント。
 * 見出し行をまたぐ場合は onHeadingCrossed に TrimResult を渡して呼び出し側に判定を委ねる。
 */
export function applySourceCommentWithHeadingGuard(
  view: EditorView,
  instruction: string,
  derivedMd: string,
  onHeadingCrossed?: (trim: TrimResult) => void,
): boolean {
  const { from, to, empty } = view.state.selection.main;
  if (empty || instruction.length === 0) {
    return applySourceComment(view, instruction);
  }
  if (onHeadingCrossed === undefined) {
    return applySourceComment(view, instruction);
  }
  if (!selectionCrossesHeading(derivedMd, from, to)) {
    return applySourceComment(view, instruction);
  }
  const trim = trimSelectionByHeadings(derivedMd, from, to);
  onHeadingCrossed(trim);
  return false;
}

/**
 * source モード: trim 範囲で直接コメントを付ける。
 * applySourceCommentWithHeadingGuard の onHeadingCrossed 経由で「OK」後の再呼び出し用。
 */
export function applySourceCommentAtRange(
  view: EditorView,
  instruction: string,
  trimmedRange: { from: number; to: number },
): boolean {
  if (instruction.length === 0) return false;
  if (trimmedRange.to <= trimmedRange.from) return false;
  view.dispatch({
    selection: { anchor: trimmedRange.from, head: trimmedRange.to },
  });
  return applySourceComment(view, instruction);
}
