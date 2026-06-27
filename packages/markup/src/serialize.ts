import type { MarkupNode, NodeKind } from './types.js';

const WRAP: Record<NodeKind, [string, string]> = {
  text: ['', ''],
  deletion: ['{--', '--}'],
  insertion: ['{++', '++}'],
  comment: ['{>>', '<<}'],
  highlight: ['{==', '==}'],
};

export function serializeCritic(nodes: MarkupNode[]): string {
  return nodes.map((n) => WRAP[n.kind][0] + n.text + WRAP[n.kind][1]).join('');
}
