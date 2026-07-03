import { describe, expect, test } from 'vitest';
import { normalizeNodes } from '../src/normalize.js';
import { reconcile } from '../src/reconcile.js';

describe('normalizeNodes（単体）', () => {
  test('隣接する同種ノードを結合する', () => {
    expect(
      normalizeNodes([
        { kind: 'text', text: 'a' },
        { kind: 'text', text: 'b' },
        { kind: 'insertion', text: 'X' },
        { kind: 'insertion', text: 'Y' },
      ]),
    ).toEqual([
      { kind: 'text', text: 'ab' },
      { kind: 'insertion', text: 'XY' },
    ]);
  });

  test('隣接する［追記, 削除］を［削除, 追記］に並べ替える（正準順序）', () => {
    expect(
      normalizeNodes([
        { kind: 'insertion', text: 'X' },
        { kind: 'deletion', text: 'Y' },
      ]),
    ).toEqual([
      { kind: 'deletion', text: 'Y' },
      { kind: 'insertion', text: 'X' },
    ]);
  });

  test('削除と追記に挟まれた短い地の文を両側へ畳む', () => {
    expect(
      normalizeNodes([
        { kind: 'deletion', text: '天' },
        { kind: 'text', text: '気' },
        { kind: 'insertion', text: '候' },
      ]),
    ).toEqual([
      { kind: 'deletion', text: '天気' },
      { kind: 'insertion', text: '気候' },
    ]);
  });

  test('3書記素以上の地の文は畳まない', () => {
    const nodes = [
      { kind: 'deletion' as const, text: 'A' },
      { kind: 'text' as const, text: 'xyz' },
      { kind: 'insertion' as const, text: 'B' },
    ];
    expect(normalizeNodes(nodes)).toEqual(nodes);
  });
});

describe('normalizeNodes（reconcile 経由）', () => {
  test('語句置換の粒度が人間の期待になる', () => {
    expect(reconcile('良い天気です', '良い気候です')).toBe(
      '良い{--天気--}{++気候++}です',
    );
  });

  test('既存追記の直後にタイプした追記が1件に結合される', () => {
    expect(reconcile('AB', 'A{++X++}YB')).toBe('A{++XY++}B');
  });
});

import { acceptView, rejectView } from '../src/views.js';

describe('normalizeNodes（不変条件と連続候補）', () => {
  test('畳み込み候補が連続しても全件処理され不変条件が保たれる', () => {
    const input = [
      { kind: 'deletion' as const, text: 'A' },
      { kind: 'text' as const, text: 'x' },
      { kind: 'insertion' as const, text: 'B' },
      { kind: 'text' as const, text: 'y' },
      { kind: 'deletion' as const, text: 'C' },
    ];
    const out = normalizeNodes(input);
    expect(acceptView(out)).toBe(acceptView(input));
    expect(rejectView(out)).toBe(rejectView(input));
    expect(out.some((n) => n.kind === 'text')).toBe(false);
  });
});
