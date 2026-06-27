/**
 * plan20 T14: source モードのコメント装飾を preview と同じ「蛍光ペン覆い + ホバー popup」に
 * 揃えるための CodeMirror 6 ViewPlugin（HLD v3 §5.6 / §11）。
 *
 * 旧仕様（plan18 までの v1.1 F6）：
 *   - `{==…==}` → `cm-critic-highlight`（蛍光ペン）
 *   - `{>>…<<}` → `cm-critic-comment`（赤字＋淡赤地ピル＋※ pseudo-element）
 *   →本文中にコメント本文がそのまま見えていた（preview と乖離）。
 *
 * 新仕様（HLD v3 §5.6）：
 *   - source モードでも preview と完全同一の「蛍光ペン + ホバー popup」表示にする。
 *   - `{>>…<<}` 全体（区切り+本文）を Decoration.replace で隠す。
 *   - `{==…==}` の中身を Decoration.mark で蛍光ペン化し、対応するコメント本文を
 *     `data-akapen-comment-instruction` 属性に埋め込む。
 *   - ホバー/クリックは ui/comment-popup.ts が `.akapen-source-comment-highlight` を
 *     selector として検知する（preview の `span.critic-comment` と並列の取込み口）。
 *
 * ## なぜ正規表現で済むか（parseCritic 経由ではなく regex を採用した理由）
 *
 * - source モードの doc は `acceptAllForDisplay(derivedMd)` を経由する＝
 *   `{--…--}` / `{++…++}` は除去済み・残るのは `{==…==}{>>…<<}` だけ。
 * - 既存 `source-redpen.ts` / `codemirror.ts changeFilter` も同じ `findCriticTokens` 正規表現を
 *   使っているため、解析エンジンを揃えれば divergence しない（pos 計算も `findCriticTokens` と同型）。
 * - parseCritic は MarkupNode[] を返すが、本プラグインに必要なのは「raw text 上の position」
 *   と「ペア化された highlight+comment の対応」だけ。findCriticTokens の方が
 *   位置情報を直接返してくれて軽量・後段の hover wiring（`data-akapen-comment-instruction`）も
 *   同期取り回しが楽。
 * - 重い lexer を増やさず、既存と同じ単一の正規表現（packages/markup/src/parse.ts の TOKEN）に
 *   集約することで「source 経路の解析エンジンが 2 系統になる」divergence を作らない。
 *
 * ## 編集モードへの遷移
 *
 * クリックで `comment-popup.ts` の編集モードが開く（preview と同じ DOM ベース）。
 * 編集確定後の rawMd 反映は app.ts の `onEditComment` コールバックが既存の
 * `editComment(buildCommandContext(...))` を呼ぶ経路で配線する（preview と同型）。
 * 本ファイルは「装飾と hover target の DOM 化」だけを責務とする。
 *
 * ## 隠した区切りの atomic 化
 *
 * `EditorView.atomicRanges` で隠した範囲をカーソル移動の単位にし、見えない `{>>…<<}` の
 * 内側にキャレットが入り込まないようにする（source-redpen.ts と同じ防衛）。
 */
import { findCriticTokens } from '@akapen/markup';
import type { Extension, Range, Text } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';

/** highlight 中身に被せる mark の class（ui/comment-popup.ts の hover selector と同期） */
export const SOURCE_COMMENT_HIGHLIGHT_CLASS = 'akapen-source-comment-highlight';

/** instruction を span 要素に持たせるための data 属性名（hover popup が読む） */
export const SOURCE_COMMENT_INSTRUCTION_ATTR = 'data-akapen-comment-instruction';

const SOURCE_COMMENT_MARKER_CLASS = 'akapen-source-comment-marker';

class SourceCommentMarkerWidget extends WidgetType {
  constructor(readonly instruction: string) {
    super();
  }

  eq(other: SourceCommentMarkerWidget): boolean {
    return other.instruction === this.instruction;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `${SOURCE_COMMENT_MARKER_CLASS} ${SOURCE_COMMENT_HIGHLIGHT_CLASS}`;
    span.setAttribute(SOURCE_COMMENT_INSTRUCTION_ATTR, this.instruction);
    span.textContent = '※';
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** {==…==}{>>…<<} を `instruction` を埋め込んだ蛍光ペン span に畳む decoration 群 */
interface BuiltDecorations {
  /** view.decorations 用（mark + replace 混合） */
  all: DecorationSet;
  /** EditorView.atomicRanges 用（隠した {>>…<<} 区間だけ） */
  hidden: DecorationSet;
}

/**
 * `{==…==}` の直後にぴったり続く `{>>…<<}` をペアとして拾う。
 * HLD v3 §5.6 の前提＝コメントは `{==…==}{>>…<<}` を1セットで生成する（applyComment）
 * ＝間に空白や他文字が割り込むことはない。間に何か入っていた場合は装飾しない
 * （旧 redPenView の見た目に倒れる＝silent corruption を作らない）。
 */
interface CommentPair {
  /** highlight 全体の開始位置（`{` の位置） */
  highlightFrom: number;
  /** highlight 全体の終了位置（`}` の次の位置） */
  highlightTo: number;
  /** comment 全体の終了位置（`}` の次の位置）＝ペア全体の終端 */
  commentTo: number;
  /** instruction 本文（`{>>` と `<<}` を除いた中身） */
  instruction: string;
}

function findCommentPairs(src: string): CommentPair[] {
  const hits = findCriticTokens(src);
  const pairs: CommentPair[] = [];
  for (let i = 0; i + 1 < hits.length; i++) {
    const h = hits[i];
    const c = hits[i + 1];
    if (!h.token.startsWith('{==')) continue;
    if (!c.token.startsWith('{>>')) continue;
    if (h.index + h.token.length !== c.index) continue; // 間に何か挟まれていたら無視
    const instruction = c.token.slice(3, -3); // `{>>` と `<<}` を除く
    pairs.push({
      highlightFrom: h.index,
      highlightTo: h.index + h.token.length,
      commentTo: c.index + c.token.length,
      instruction,
    });
    i += 1; // 次の hit（comment）はペア消費済み
  }
  return pairs;
}

/** 区切り/コメント token を隠す（doc には残る＝表示だけ消える・source-redpen.ts と同型） */
const hideDelimiter = Decoration.mark({ class: 'cm-critic-hidden' });

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

function buildCommentDecorations(doc: Text): BuiltDecorations {
  const all: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  const src = doc.toString();
  const pairs = findCommentPairs(src);

  for (const pair of pairs) {
    // {== の3文字を隠す（source-redpen.ts と同じ・上書きしても同じ結果）
    pushReplaceRange(all, doc, pair.highlightFrom, pair.highlightFrom + 3);
    pushReplaceRange(hidden, doc, pair.highlightFrom, pair.highlightFrom + 3);
    // highlight 内側を蛍光ペン + hover target に
    const innerFrom = pair.highlightFrom + 3;
    const innerTo = pair.highlightTo - 3;
    if (innerTo > innerFrom) {
      all.push(
        Decoration.mark({
          class: `${SOURCE_COMMENT_HIGHLIGHT_CLASS} cm-critic-highlight`,
          attributes: { [SOURCE_COMMENT_INSTRUCTION_ATTR]: pair.instruction },
        }).range(innerFrom, innerTo),
      );
      all.push(
        Decoration.widget({
          side: 1,
          widget: new SourceCommentMarkerWidget(pair.instruction),
        }).range(innerTo),
      );
    }
    // `==}{>>…<<}` 全体を隠す（区切り3文字＋comment 本体＋区切り3文字）
    pushReplaceRange(all, doc, pair.highlightTo - 3, pair.commentTo);
    pushReplaceRange(hidden, doc, pair.highlightTo - 3, pair.commentTo);
  }

  return { all: Decoration.set(all, true), hidden: Decoration.set(hidden, true) };
}

const sourceCommentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    hidden: DecorationSet;
    constructor(view: EditorView) {
      const built = buildCommentDecorations(view.state.doc);
      this.decorations = built.all;
      this.hidden = built.hidden;
    }
    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      const built = buildCommentDecorations(update.state.doc);
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

/**
 * source モード（CM6）のコメント装飾拡張＝plan20 T14。
 *
 * - `{==…==}{>>…<<}` ペアを「蛍光ペン + ホバー popup」に畳む（preview と同じ見え方）。
 * - 装飾は表示層だけ＝doc（rawMd に流れるデータ）は生記法のまま一切変えない。
 * - 単一ペアでない highlight や comment は本プラグインでは触らず、`source-redpen.ts` の
 *   既存装飾に委ねる（divergence を作らない・safety bias）。
 */
export function sourceCommentDecorationExtension(): Extension {
  return sourceCommentPlugin;
}
