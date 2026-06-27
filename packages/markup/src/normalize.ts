import { graphemeCount } from './graphemes.js';
import type { MarkupNode, NodeKind } from './types.js';

const MERGEABLE = new Set<NodeKind>(['text', 'deletion', 'insertion']);

// 差分が機械的に刻んだノード列を人間の期待に寄せる整形。
// どの整形も「全却下＝base・全採用＝見た目」の不変条件を変えない
// （変えていないことは reconcile 側の整合性自己検査が常に確認する）。
export function normalizeNodes(nodes: MarkupNode[]): MarkupNode[] {
  let cur = nodes.map((n) => ({ ...n }));
  for (;;) {
    let changed = false;

    // 1) 正準順序: 隣接する［追記, 削除］→［削除, 追記］
    for (let i = 0; i + 1 < cur.length; i++) {
      const x = cur[i];
      const y = cur[i + 1];
      if (x && y && x.kind === 'insertion' && y.kind === 'deletion') {
        cur[i] = y;
        cur[i + 1] = x;
        changed = true;
      }
    }

    // 2) 隣接同種の結合（comment/highlight は対象外・空ノードは落とす）
    const merged: MarkupNode[] = [];
    for (const n of cur) {
      if (n.text === '' && n.kind !== 'comment') {
        changed = true;
        continue;
      }
      const prev = merged[merged.length - 1];
      if (prev && prev.kind === n.kind && MERGEABLE.has(n.kind)) {
        prev.text += n.text;
        changed = true;
      } else {
        merged.push(n);
      }
    }
    cur = merged;

    // 3) 置換粒度: 削除と追記に挟まれた2書記素以下の地の文を両側へ畳む
    for (let i = 1; i + 1 < cur.length; i++) {
      const x = cur[i - 1];
      const t = cur[i];
      const y = cur[i + 1];
      if (!x || !t || !y) continue;
      const isPair =
        (x.kind === 'deletion' && y.kind === 'insertion') ||
        (x.kind === 'insertion' && y.kind === 'deletion');
      if (isPair && t.kind === 'text' && graphemeCount(t.text) <= 2) {
        x.text = x.text + t.text;
        y.text = t.text + y.text;
        cur.splice(i, 1);
        i--; // splice で詰まった分を戻す＝直後の候補を飛ばさない
        changed = true;
      }
    }

    if (!changed) return cur;
  }
}
