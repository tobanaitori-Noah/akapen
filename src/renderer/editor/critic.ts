/**
 * CriticMarkup 4記法を Milkdown(ProseMirror) のマークとして扱う層。
 *
 * 構成（マークスキーマ4種＋remark 双方向）はスパイク実証どおり
 * （docs/spike-notes.md「採用枠組みと計画2向け API メモ」が実機確認済みの正）。
 * - parse 方向: text ノード中の記法を parseCritic（markup コア）で割って
 *   カスタム mdast ノード（criticDeletion 等）へ置換する。
 *   code / inlineCode は text ノードでないため素通し＝コード内の記法風文字列は壊さない。
 * - stringify 方向: toMarkdownExtensions の handlers でカスタムノードを {--…--} 等に戻す。
 * - inclusive は insertion のみ true（追記が伸びる）・他は false
 *   （マーク直後タイプがマークを引き継がない）。
 */
import type { MarkupNode, NodeKind } from '@akapen/markup';
import { parseCritic } from '@akapen/markup';
import type { RemarkPluginRaw, Root } from '@milkdown/kit/transformer';
import { $markSchema, $remark } from '@milkdown/kit/utils';
import { SKIP, visit } from 'unist-util-visit';

export type CriticKind = Exclude<NodeKind, 'text'>;

const KIND_TO_MDAST = {
  deletion: 'criticDeletion',
  insertion: 'criticInsertion',
  comment: 'criticComment',
  highlight: 'criticHighlight',
} as const satisfies Record<CriticKind, string>;

type CriticMdastType = (typeof KIND_TO_MDAST)[CriticKind];

const MDAST_WRAP: Record<CriticMdastType, readonly [string, string]> = {
  criticDeletion: ['{--', '--}'],
  criticInsertion: ['{++', '++}'],
  criticComment: ['{>>', '<<}'],
  criticHighlight: ['{==', '==}'],
};

/** remark 連携で必要な最小形だけをローカルに型付けする（mdast レジストリ拡張はしない） */
interface MdastText {
  type: 'text';
  value: string;
}

interface CriticMdastNode {
  type: CriticMdastType;
  children: MdastText[];
}

type ToMarkdownHandler = (
  node: CriticMdastNode,
  parent: unknown,
  state: {
    containerPhrasing?: (node: CriticMdastNode, info: Record<string, unknown>) => string;
  },
  info: Record<string, unknown>,
) => string;

function remarkCritic(this: { data: () => Record<string, unknown> }) {
  // stringify 方向: カスタム mdast ノードを {--…--} 等の記法へ戻す。
  const data = this.data() as {
    toMarkdownExtensions?: Array<{ handlers: Record<string, ToMarkdownHandler> }>;
  };
  const handlers: Record<string, ToMarkdownHandler> = {};
  for (const mdastType of Object.values(KIND_TO_MDAST)) {
    const [open, close] = MDAST_WRAP[mdastType];
    handlers[mdastType] = (node, _parent, state, info) => {
      const inner =
        typeof state.containerPhrasing === 'function'
          ? state.containerPhrasing(node, { ...info, before: open, after: close })
          : node.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
      return open + inner + close;
    };
  }
  (data.toMarkdownExtensions ??= []).push({ handlers });

  // parse 方向: text ノードを parseCritic で分割しカスタム mdast ノードに置換する。
  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      if (index === undefined || !parent) return undefined;
      const parts: MarkupNode[] = parseCritic(node.value);
      if (!parts.some((p) => p.kind !== 'text')) return undefined;
      const replacement: Array<MdastText | CriticMdastNode> = parts.map((p) =>
        p.kind === 'text'
          ? { type: 'text' as const, value: p.text }
          : { type: KIND_TO_MDAST[p.kind], children: [{ type: 'text' as const, value: p.text }] },
      );
      // カスタムノード型は mdast の組み込みレジストリに無い＝この1行だけ型を外す
      (parent.children as unknown[]).splice(index, 1, ...replacement);
      return [SKIP, index + replacement.length];
    });
  };
}

export const criticRemark = $remark(
  'criticRemark',
  // unified Plugin の this 型と remarkCritic の宣言は構造一致しないため、
  // remark 連携の不可避なキャストはこの1箇所に局所化する
  () => remarkCritic as unknown as RemarkPluginRaw<unknown>,
);

function criticMarkSchema(kind: CriticKind, tag: string) {
  const mdastType = KIND_TO_MDAST[kind];
  return $markSchema(mdastType, () => ({
    inclusive: kind === 'insertion',
    parseDOM: [{ tag: `${tag}.critic-${kind}` }],
    toDOM: () => [tag, { class: `critic-${kind}` }] as const,
    parseMarkdown: {
      match: (node) => node.type === mdastType,
      runner: (state, node, markType) => {
        state.openMark(markType);
        state.next(node.children);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === mdastType,
      runner: (state, mark) => {
        state.withMark(mark, mdastType);
      },
    },
  }));
}

export const deletionSchema = criticMarkSchema('deletion', 'del');
export const insertionSchema = criticMarkSchema('insertion', 'ins');
export const commentSchema = criticMarkSchema('comment', 'span');
export const highlightSchema = criticMarkSchema('highlight', 'mark');

/** critic 4マークのスキーマ一覧（マーク剥がし等で列挙する時の唯一の並び） */
export const criticMarkSchemas = [
  deletionSchema,
  insertionSchema,
  commentSchema,
  highlightSchema,
] as const;
