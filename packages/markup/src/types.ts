export type NodeKind = 'text' | 'deletion' | 'insertion' | 'comment' | 'highlight';

export interface MarkupNode {
  kind: NodeKind;
  text: string;
}
