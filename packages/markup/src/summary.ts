import { clipGraphemes, graphemeCount } from './graphemes.js';
import type { MarkupNode } from './types.js';

// 書記素単位で切る＝絵文字のサロゲートペアを分断しない
const clip = (s: string, n = 60): string => clipGraphemes(s, n);

export interface SummaryOptions {
  globalNote?: string;
  baseText?: string;
}

export interface ReadingGuideOptions {
  globalNote?: string;
  baseText?: string;
}

const nonEmptyLineCount = (s: string): number =>
  s.split(/\r?\n/).filter((line) => line.trim() !== '').length;

const paragraphCount = (s: string): number =>
  s.split(/\r?\n\s*\r?\n/).filter((para) => para.trim() !== '').length;

const isWholeBodyTarget = (target: string, baseText?: string): boolean => {
  const targetTrimmed = target.trim();
  const baseTrimmed = baseText?.trim() ?? '';
  if (!targetTrimmed || !baseTrimmed) return false;
  if (targetTrimmed === baseTrimmed) return true;

  const targetSize = graphemeCount(targetTrimmed);
  const baseSize = graphemeCount(baseTrimmed);
  return baseSize > 0 && targetSize / baseSize >= 0.9;
};

const targetScopeLabel = (target: string, baseText?: string): string => {
  const trimmed = target.trim();
  if (!trimmed) return '';

  const size = graphemeCount(trimmed);
  if (isWholeBodyTarget(trimmed, baseText)) return `（本文全体・${size}字）`;
  if (paragraphCount(trimmed) >= 2) return `（複数段落・${size}字）`;
  if (nonEmptyLineCount(trimmed) >= 2) return `（複数行・${size}字）`;
  if (size >= 200) return `（長文範囲・${size}字）`;
  return '';
};

const hasWideScopedComment = (nodes: MarkupNode[], baseText?: string): boolean =>
  nodes.some((n, i) => {
    if (n.kind !== 'comment') return false;
    const prev = i > 0 ? nodes[i - 1] : undefined;
    return prev?.kind === 'highlight' && targetScopeLabel(prev.text, baseText) !== '';
  });

export function buildCriticMarkupReadingGuide(
  nodes: MarkupNode[],
  opts: ReadingGuideOptions = {},
): string {
  const lines = [
    '# AI向け読み取りルール（CriticMarkup）',
    '',
    '本文は CriticMarkup 記法です。AI は以下の範囲ルールを優先して読み取ってください。',
    '',
    '- `{--text--}`: `text` は削除提案です。',
    '- `{++text++}`: `text` は追記提案です。',
    '- `{==text==}{>>instruction<<}`: `instruction` は、直前の一文ではなく `{==` と `==}` で囲まれた `text` 全体へのコメントです。',
    '- コメント対象が複数行・複数段落・本文全体に及ぶ場合も、最後の文章だけでなく囲まれた範囲全体に適用してください。',
  ];

  if (opts.globalNote?.trim()) {
    lines.push(
      '- `全体指示` は、本文全体にかかる方針として個別マークより先に確認してください。',
    );
  }

  if (hasWideScopedComment(nodes, opts.baseText)) {
    lines.push(
      '',
      '## 範囲コメントの注意',
      '',
      '- このファイルには、複数行・複数段落・長文範囲・本文全体のいずれかにかかるコメントがあります。サマリの「対象（...）」と本文中の `{==...==}` 囲みを見て、対象範囲全体を修正してください。',
    );
  }

  return lines.join('\n');
}

// AI が最初に読む「何がしたいか」の一覧。本文と同じノード列から生成＝二重入力なし。
export function buildSummary(nodes: MarkupNode[], opts: SummaryOptions = {}): string {
  const lines: string[] = [];
  let no = 1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    if (n.kind === 'deletion') lines.push(`${no++}. 【削除】「${clip(n.text)}」`);
    else if (n.kind === 'insertion') lines.push(`${no++}. 【追記】「${clip(n.text)}」`);
    else if (n.kind === 'comment') {
      const prev = i > 0 ? nodes[i - 1] : undefined;
      const target = prev?.kind === 'highlight' ? prev.text : null;
      const scope = target !== null ? targetScopeLabel(target, opts.baseText) : '';
      lines.push(
        target !== null
          ? `${no++}. 【指示】対象${scope}「${clip(target)}」→ ${clip(n.text, 200)}`
          : `${no++}. 【指示】${clip(n.text, 200)}`,
      );
    }
  }
  const note = opts.globalNote?.trim();
  if (note) lines.push(`${no++}. 【全体指示】${note}`);
  return lines.length > 0 ? lines.join('\n') : '（変更・指示なし）';
}

export interface ChangeCounts {
  deletion: number;
  insertion: number;
  comment: number;
}

export function countChanges(nodes: MarkupNode[], globalNote?: string): ChangeCounts {
  const c: ChangeCounts = { deletion: 0, insertion: 0, comment: 0 };
  for (const n of nodes) {
    if (n.kind === 'deletion') c.deletion++;
    else if (n.kind === 'insertion') c.insertion++;
    else if (n.kind === 'comment') c.comment++;
  }
  if (globalNote?.trim()) c.comment++;
  return c;
}
