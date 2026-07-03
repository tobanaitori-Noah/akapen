import { describe, expect, test } from 'vitest';
import { parseCritic } from '../src/parse.js';
import { serializeCritic } from '../src/serialize.js';

describe('serializeCritic', () => {
  test('各ノードを記法で包む', () => {
    expect(
      serializeCritic([
        { kind: 'text', text: 'A' },
        { kind: 'deletion', text: 'B' },
        { kind: 'insertion', text: 'C' },
        { kind: 'highlight', text: 'D' },
        { kind: 'comment', text: 'E' },
      ]),
    ).toBe('A{--B--}{++C++}{==D==}{>>E<<}');
  });

  test('往復一致: serialize(parse(s)) === s', () => {
    const samples = [
      'ただの文章です。',
      'A{--削る--}B{++足す++}C{==対象==}{>>指示文<<}D',
      '{--改行\nまたぎ--}end',
      '',
    ];
    for (const s of samples) {
      expect(serializeCritic(parseCritic(s))).toBe(s);
    }
  });
});
