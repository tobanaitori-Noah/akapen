import { describe, expect, test } from 'vitest';
import { findCriticTokens, parseCritic } from '../src/parse.js';

describe('parseCritic', () => {
  test('地の文だけなら text ノード1つ', () => {
    expect(parseCritic('こんにちは。')).toEqual([{ kind: 'text', text: 'こんにちは。' }]);
  });

  test('4記法を順に解析する', () => {
    expect(
      parseCritic('A{--B--}C{++D++}E{==F==}{>>G<<}H'),
    ).toEqual([
      { kind: 'text', text: 'A' },
      { kind: 'deletion', text: 'B' },
      { kind: 'text', text: 'C' },
      { kind: 'insertion', text: 'D' },
      { kind: 'text', text: 'E' },
      { kind: 'highlight', text: 'F' },
      { kind: 'comment', text: 'G' },
      { kind: 'text', text: 'H' },
    ]);
  });

  test('マークは改行をまたげる', () => {
    expect(parseCritic('{--1行目\n2行目--}')).toEqual([
      { kind: 'deletion', text: '1行目\n2行目' },
    ]);
  });

  test('閉じない波括弧は地の文として通す', () => {
    expect(parseCritic('A {--閉じない B')).toEqual([
      { kind: 'text', text: 'A {--閉じない B' },
    ]);
  });

  test('置換記法 {~~old~>new~~} は非対応＝地の文として素通し', () => {
    expect(parseCritic('A{~~古い~>新しい~~}B')).toEqual([
      { kind: 'text', text: 'A{~~古い~>新しい~~}B' },
    ]);
  });

  test('空文字列は空配列', () => {
    expect(parseCritic('')).toEqual([]);
  });
});

describe('findCriticTokens（元原稿の衝突記法の検知）', () => {
  test('記法風文字列が無ければ空', () => {
    expect(findCriticTokens('普通の記事です。`code` も含む。')).toEqual([]);
  });

  test('コード例などに記法風文字列があれば位置つきで報告する', () => {
    expect(findCriticTokens('例: `{++追加++}` と書く')).toEqual([
      { token: '{++追加++}', index: 4 },
    ]);
  });
});
