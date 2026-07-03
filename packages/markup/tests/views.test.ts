import { describe, expect, test } from 'vitest';
import { parseCritic } from '../src/parse.js';
import { acceptView, rejectView } from '../src/views.js';

describe('acceptView / rejectView', () => {
  const nodes = parseCritic('A{--B--}C{++D++}{==E==}{>>指示<<}F');

  test('全採用＝削除を実行し追記を残す（コメントは消える・対象範囲は本文）', () => {
    expect(acceptView(nodes)).toBe('ACDEF');
  });

  test('全却下＝元原稿に戻る', () => {
    expect(rejectView(nodes)).toBe('ABCEF');
  });

  test('分割された複数行追記は改行も追記として却下する', () => {
    const paragraph = parseCritic('A{++X++}\n\n{++Y++}B');
    const hardBreak = parseCritic('A{++X++}\n{++Y++}B');

    expect(acceptView(paragraph)).toBe('AX\n\nYB');
    expect(rejectView(paragraph)).toBe('AB');
    expect(acceptView(hardBreak)).toBe('AX\nYB');
    expect(rejectView(hardBreak)).toBe('AB');
  });

  test('追記に挟まれていても次の本文がブロック行なら base の改行として保持する', () => {
    const nodes = parseCritic('- first{++X++}\n  {++Y++}- second');

    expect(acceptView(nodes)).toBe('- firstX\n  Y- second');
    expect(rejectView(nodes)).toBe('- first\n  - second');
  });

  test('複数の追記を除いた先がブロック行なら base の改行として保持する', () => {
    const nodes = parseCritic(
      '- keys{++A++}\n{++B++} {++C++} - 1. value',
    );

    expect(acceptView(nodes)).toBe('- keysA\nB C - 1. value');
    expect(rejectView(nodes)).toBe('- keys\n  - 1. value');
  });

  test('見出し行の後続改行は追記に挟まれていても base の改行として保持する', () => {
    const nodes = parseCritic('# H{++x++}\n{++y++}本文');

    expect(acceptView(nodes)).toBe('# Hx\ny本文');
    expect(rejectView(nodes)).toBe('# H\n本文');
  });

  test('削除行の後続改行は追記に挟まれていても base の改行として保持する', () => {
    const nodes = parseCritic('{--消す本文1。--}{++注意++}\n{++---\n\n++}消す本文2。');

    expect(rejectView(nodes)).toBe('消す本文1。\n消す本文2。');
  });

  test('削除された Markdown 接頭辞を含む行の後続改行も base の改行として保持する', () => {
    const nodes = parseCritic('{--##--} 見出し{++  ++}\n{++\n++}本文');

    expect(rejectView(nodes)).toBe('## 見出し\n本文');
  });
});
