import type { MarkupNode } from './types.js';

const TOKEN =
  /\{--([\s\S]*?)--\}|\{\+\+([\s\S]*?)\+\+\}|\{>>([\s\S]*?)<<\}|\{==([\s\S]*?)==\}/g;

export function parseCritic(src: string): MarkupNode[] {
  const nodes: MarkupNode[] = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) nodes.push({ kind: 'text', text: src.slice(last, at) });
    if (m[1] !== undefined) nodes.push({ kind: 'deletion', text: m[1] });
    else if (m[2] !== undefined) nodes.push({ kind: 'insertion', text: m[2] });
    else if (m[3] !== undefined) nodes.push({ kind: 'comment', text: m[3] });
    else if (m[4] !== undefined) nodes.push({ kind: 'highlight', text: m[4] });
    else throw new Error('parseCritic internal: TOKEN matched but no group captured');
    last = at + m[0].length;
  }
  if (last < src.length) nodes.push({ kind: 'text', text: src.slice(last) });
  return nodes;
}

export interface TokenHit {
  token: string;
  index: number;
}

// 元原稿に「既に」CriticMarkup 風文字列が含まれていないかの検知器。
// アプリはファイルを開く時にこれを呼び、ヒットがあれば owner に警告する
// （markdown のコード文脈は見ない＝v1 の明文化された制限）。
export function findCriticTokens(src: string): TokenHit[] {
  const hits: TokenHit[] = [];
  for (const m of src.matchAll(TOKEN)) {
    hits.push({ token: m[0], index: m.index ?? 0 });
  }
  return hits;
}
