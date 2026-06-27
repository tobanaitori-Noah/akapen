import type { MarkupNode } from './types.js';

// 全提案を採用した姿（削除を実行・追記を残す・コメントは消える・対象範囲は本文のまま）
export function acceptView(nodes: MarkupNode[]): string {
  return nodes
    .filter((n) => n.kind === 'text' || n.kind === 'insertion' || n.kind === 'highlight')
    .map((n) => n.text)
    .join('');
}

function isInsertionLineSeparator(nodes: MarkupNode[], index: number): boolean {
  const node = nodes[index];
  const followingLine = lineAfterSeparatorWithoutInsertions(nodes, index);
  const previousLine = lineBeforeSeparatorWithoutInsertions(nodes, index);
  const previousNode = previousNodeWithoutInsertions(nodes, index);
  if (previousNode?.kind === 'deletion') return false;
  if (lineBeforeSeparatorHasDeletion(nodes, index)) return false;
  return (
    node?.kind === 'text' &&
    node.text.includes('\n') &&
    node.text.trim().length === 0 &&
    nodes[index - 1]?.kind === 'insertion' &&
    nodes[index + 1]?.kind === 'insertion' &&
    !/^[ \t]{0,3}#{1,6}[ \t]+/.test(previousLine) &&
    !/^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?|(?:-{3,}|\*{3,}|_{3,})(?:[ \t]|\n|$))/.test(
      followingLine,
    )
  );
}

function lineBeforeSeparatorHasDeletion(
  nodes: MarkupNode[],
  separatorIndex: number,
): boolean {
  let sawDeletion = false;
  for (let i = separatorIndex - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node) break;
    if (node.kind === 'insertion') continue;
    if (node.kind === 'deletion') {
      sawDeletion = true;
      continue;
    }
    if (node.kind === 'text') {
      if (node.text.includes('\n')) return sawDeletion;
      continue;
    }
    return sawDeletion;
  }
  return sawDeletion;
}

function previousNodeWithoutInsertions(
  nodes: MarkupNode[],
  separatorIndex: number,
): MarkupNode | null {
  for (let i = separatorIndex - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node) break;
    if (node.kind === 'insertion') continue;
    return node;
  }
  return null;
}

function lineAfterSeparatorWithoutInsertions(
  nodes: MarkupNode[],
  separatorIndex: number,
): string {
  let line = '';
  for (let i = separatorIndex + 1; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) break;
    if (node.kind === 'insertion') continue;
    if (node.kind !== 'text') break;
    const newline = node.text.indexOf('\n');
    if (newline >= 0) {
      line += node.text.slice(0, newline);
      break;
    }
    line += node.text;
    if (line.length > 200) break;
  }
  return line;
}

function lineBeforeSeparatorWithoutInsertions(
  nodes: MarkupNode[],
  separatorIndex: number,
): string {
  let line = '';
  for (let i = separatorIndex - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node) break;
    if (node.kind === 'insertion') continue;
    if (node.kind !== 'text') break;
    const newline = node.text.lastIndexOf('\n');
    if (newline >= 0) {
      line = node.text.slice(newline + 1) + line;
      break;
    }
    line = node.text + line;
    if (line.length > 200) break;
  }
  return line;
}

// 全提案を却下した姿（元原稿に戻る）
export function rejectView(nodes: MarkupNode[]): string {
  return nodes
    .filter(
      (n, index) =>
        n.kind === 'deletion' ||
        n.kind === 'highlight' ||
        (n.kind === 'text' && !isInsertionLineSeparator(nodes, index)),
    )
    .map((n) => n.text)
    .join('');
}
