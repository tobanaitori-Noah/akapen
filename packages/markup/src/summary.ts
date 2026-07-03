import { graphemeCount } from './graphemes.js';
import type { MarkupNode } from './types.js';

export type MarkupLanguage = 'ja' | 'en';

export interface SummaryOptions {
  globalNote?: string;
  baseText?: string;
  language?: MarkupLanguage;
}

export type ReadingGuideOptions = SummaryOptions;

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

const normalizeLanguage = (language: MarkupLanguage | undefined): MarkupLanguage =>
  language === 'en' ? 'en' : 'ja';

const labels = {
  ja: {
    wholeBody: '本文全体',
    paragraphs: '複数段落',
    lines: '複数行',
    longRange: '長文範囲',
    chars: '字',
    readingGuideTitle: '# AI向け読み取りルール（CriticMarkup）',
    readingGuideIntro: '本文は CriticMarkup 記法です。AI は以下の範囲ルールを優先して読み取ってください。',
    deletionRule: '- `{--text--}`: `text` は削除提案です。',
    insertionRule: '- `{++text++}`: `text` は追記提案です。',
    commentRule: '- `{==text==}{>>instruction<<}`: `instruction` は、直前の一文ではなく `{==` と `==}` で囲まれた `text` 全体へのコメントです。',
    commentScopeRule: '- コメント対象が複数行・複数段落・本文全体に及ぶ場合も、最後の文章だけでなく囲まれた範囲全体に適用してください。',
    globalNoteRule: '- `全体指示` は、本文全体にかかる方針として個別マークより先に確認してください。',
    rangeCommentTitle: '## 範囲コメントの注意',
    rangeCommentRule: '- このファイルには、複数行・複数段落・長文範囲・本文全体のいずれかにかかるコメントがあります。本文中の `{==...==}` 囲みを見て、対象範囲全体を修正してください。',
  },
  en: {
    wholeBody: 'entire body',
    paragraphs: 'multiple paragraphs',
    lines: 'multiple lines',
    longRange: 'long range',
    chars: 'chars',
    readingGuideTitle: '# Reading guide for AI (CriticMarkup)',
    readingGuideIntro: 'The body uses CriticMarkup. AI should prioritize the range rules below.',
    deletionRule: '- `{--text--}`: `text` is a deletion suggestion.',
    insertionRule: '- `{++text++}`: `text` is an addition suggestion.',
    commentRule: '- `{==text==}{>>instruction<<}`: `instruction` is a comment on the entire `text` range enclosed by `{==` and `==}`, not only on the preceding sentence.',
    commentScopeRule: '- If a comment target spans multiple lines, multiple paragraphs, or the whole body, apply it to the entire enclosed range, not only to the final sentence.',
    globalNoteRule: '- `Global instruction` applies to the whole body. Check it before individual marks.',
    rangeCommentTitle: '## Note on range comments',
    rangeCommentRule: '- This file contains at least one comment that applies to multiple lines, multiple paragraphs, a long range, or the whole body. Use the `{==...==}` enclosure in the body to revise the entire target range.',
  },
} as const;

const targetScopeLabel = (
  target: string,
  baseText?: string,
  language: MarkupLanguage = 'ja',
): string => {
  const trimmed = target.trim();
  if (!trimmed) return '';

  const size = graphemeCount(trimmed);
  const l = labels[language];
  const scope = (label: string): string =>
    language === 'en' ? ` (${label}, ${size} chars)` : `（${label}・${size}${l.chars}）`;
  if (isWholeBodyTarget(trimmed, baseText)) return scope(l.wholeBody);
  if (paragraphCount(trimmed) >= 2) return scope(l.paragraphs);
  if (nonEmptyLineCount(trimmed) >= 2) return scope(l.lines);
  if (size >= 200) return scope(l.longRange);
  return '';
};

const hasWideScopedComment = (
  nodes: MarkupNode[],
  baseText?: string,
  language: MarkupLanguage = 'ja',
): boolean =>
  nodes.some((n, i) => {
    if (n.kind !== 'comment') return false;
    const prev = i > 0 ? nodes[i - 1] : undefined;
    return prev?.kind === 'highlight' && targetScopeLabel(prev.text, baseText, language) !== '';
  });

export function buildCriticMarkupReadingGuide(
  nodes: MarkupNode[],
  opts: ReadingGuideOptions = {},
): string {
  const language = normalizeLanguage(opts.language);
  const l = labels[language];
  const lines = [
    l.readingGuideTitle,
    '',
    l.readingGuideIntro,
    '',
    l.deletionRule,
    l.insertionRule,
    l.commentRule,
    l.commentScopeRule,
  ];

  if (opts.globalNote?.trim()) {
    lines.push(
      l.globalNoteRule,
    );
  }

  if (hasWideScopedComment(nodes, opts.baseText, language)) {
    lines.push(
      '',
      l.rangeCommentTitle,
      '',
      l.rangeCommentRule,
    );
  }

  return lines.join('\n');
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
