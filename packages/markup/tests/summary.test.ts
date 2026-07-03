import { describe, expect, test } from 'vitest';
import { parseCritic } from '../src/parse.js';
import { buildCriticMarkupReadingGuide, countChanges } from '../src/summary.js';

describe('countChanges', () => {
  test('種別ごとに数える（全体指示は指示に含める）', () => {
    const nodes = parseCritic('{--A--}{--B--}{++C++}{==D==}{>>E<<}');
    expect(countChanges(nodes, '全体も')).toEqual({
      deletion: 2,
      insertion: 1,
      comment: 2,
    });
  });
});

describe('buildCriticMarkupReadingGuide', () => {
  test('コメントの適用範囲は囲まれた text 全体だと説明する', () => {
    const nodes = parseCritic('{==本文全体==}{>>短く<<}');
    const guide = buildCriticMarkupReadingGuide(nodes);
    expect(guide).toContain(
      '`{==text==}{>>instruction<<}`: `instruction` は、直前の一文ではなく `{==` と `==}` で囲まれた `text` 全体へのコメントです。',
    );
  });

  test('広い範囲コメントがある場合は追加注意を出す', () => {
    const base = '一段落目。\n\n二段落目。';
    const nodes = parseCritic(`{==${base}==}{>>全体を読みやすく<<}`);
    const guide = buildCriticMarkupReadingGuide(nodes, { baseText: base });
    expect(guide).toContain('## 範囲コメントの注意');
    expect(guide).toContain('対象範囲全体を修正してください');
  });

  test('英語の読み取りルールを出せる', () => {
    const nodes = parseCritic('{==whole body==}{>>shorten<<}');
    const guide = buildCriticMarkupReadingGuide(nodes, { baseText: 'whole body', language: 'en' });
    expect(guide).toContain('# Reading guide for AI (CriticMarkup)');
    expect(guide).toContain('is a deletion suggestion');
    expect(guide).toContain('## Note on range comments');
  });
});
