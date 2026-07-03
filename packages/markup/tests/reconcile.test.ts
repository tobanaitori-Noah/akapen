import { describe, expect, test } from 'vitest';
import { parseCritic } from '../src/parse.js';
import { IntegrityError, reconcile } from '../src/reconcile.js';
import { acceptView, rejectView } from '../src/views.js';

describe('reconcile', () => {
  test('変更なしなら同一文字列', () => {
    expect(reconcile('そのまま', 'そのまま')).toBe('そのまま');
  });

  test('プレーンな追記が {++…++} 化される', () => {
    expect(reconcile('こんにちは。', 'こんにちは。追記です。')).toBe(
      'こんにちは。{++追記です。++}',
    );
  });

  test('文中への追記も位置ごとマーク化される', () => {
    expect(reconcile('ABEF', 'ABCDEF')).toBe('AB{++CD++}EF');
  });

  test('マーク無しで消された本文が {--…--} で復元される', () => {
    expect(reconcile('AAABBBCCC', 'AAACCC')).toBe('AAA{--BBB--}CCC');
  });

  test('既存の削除マーク・コメント・対象範囲は保持される', () => {
    const w = 'AAA{--BBB--}CCC{==DDD==}{>>具体例を1つ<<}EEE';
    expect(reconcile('AAABBBCCCDDDEEE', w)).toBe(w);
  });

  test('置換＝削除マーク＋直後のタイプ → 削除保持＋追記化', () => {
    expect(reconcile('良い天気', '良い{--天気--}気候')).toBe(
      '良い{--天気--}{++気候++}',
    );
  });

  test('削除マークと直の削除が隣接したら1つの削除に畳まれる', () => {
    expect(reconcile('ABCD', 'A{--B--}D')).toBe('A{--BC--}D');
  });

  test('複数行の本文でも動く', () => {
    expect(
      reconcile('1行目\n2行目\n3行目', '1行目\n2行目を直した\n3行目'),
    ).toBe('1行目\n2行目{++を直した++}\n3行目');
  });

  test('肌色つき絵文字は見た目1文字として扱う（分断しない）', () => {
    expect(reconcile('👍🏻です', '👍🏽です')).toBe('{--👍🏻--}{++👍🏽++}です');
  });

  test('CRLF 改行が保持される', () => {
    expect(reconcile('A\r\nB', 'A\r\nXB')).toBe('A\r\n{++X++}B');
  });

  test('冪等性: 一度 reconcile した結果を再投入しても変わらない', () => {
    const once = reconcile('良い天気です', '良い気候です');
    expect(reconcile('良い天気です', once)).toBe(once);
  });

  test('不変条件: 全却下＝base・全採用＝編集後の見た目', () => {
    const base = '春の朝。鳥が鳴く。';
    const working = '春の{--朝--}夕{==鳥==}{>>種類を具体的に<<}が鳴く。すばらしい。';
    const out = reconcile(base, working);
    expect(rejectView(parseCritic(out))).toBe(base);
    expect(acceptView(parseCritic(out))).toBe(acceptView(parseCritic(working)));
  });

  test('記法と衝突する文字列を打たれたら黙って保存せず IntegrityError', () => {
    expect(() => reconcile('', 'C++}')).toThrow(IntegrityError);
  });
});

describe('reconcile（レビュー指摘の回帰防止）', () => {
  test('highlight に隣接する短い地の文があっても誤って畳まれない', () => {
    const w = '{--気--}A{==候==}{>>直せ<<}';
    expect(reconcile('気A候', w)).toBe(w);
  });

  test('作業本文が空なら全文が削除マークになる（仕様。確認UIは計画2のアプリ層）', () => {
    expect(reconcile('元原稿', '')).toBe('{--元原稿--}');
  });
});
