import { describe, expect, test } from 'vitest';
import { assembleReviewFile } from '../src/assemble.js';
import { IntegrityError } from '../src/reconcile.js';

describe('assembleReviewFile', () => {
  test('frontmatter＋読み取りガイド＋本文の1ファイルに組み上がる', () => {
    const out = assembleReviewFile({
      baseFileName: 'draft.md',
      baseText: '良い天気です。冗長な一文。終わり。',
      workingText: '良い天気です。{--冗長な一文。--}本題を足す。終わり。',
      reviewedAt: '2026-06-11',
      globalNote: 'もっと砕けた調子に',
    });

    expect(out).toBe(
      [
        '---',
        'base: "draft.md"',
        'reviewed_at: "2026-06-11"',
        'changes: "削除1・追記1・指示1"',
        'generator: "AkaPen v1"',
        '---',
        '',
        '# AI向け読み取りルール（CriticMarkup）',
        '',
        '本文は CriticMarkup 記法です。AI は以下の範囲ルールを優先して読み取ってください。',
        '',
        '- `{--text--}`: `text` は削除提案です。',
        '- `{++text++}`: `text` は追記提案です。',
        '- `{==text==}{>>instruction<<}`: `instruction` は、直前の一文ではなく `{==` と `==}` で囲まれた `text` 全体へのコメントです。',
        '- コメント対象が複数行・複数段落・本文全体に及ぶ場合も、最後の文章だけでなく囲まれた範囲全体に適用してください。',
        '- `全体指示` は、本文全体にかかる方針として個別マークより先に確認してください。',
        '',
        '---',
        '',
        '# 本文（添削入り全文・CriticMarkup 記法）',
        '',
        '良い天気です。{--冗長な一文。--}{++本題を足す。++}終わり。',
        '',
      ].join('\n'),
    );
  });

  test('reconcile を内包する＝プレーン追記が本文で {++…++} になっている', () => {
    const out = assembleReviewFile({
      baseFileName: 'a.md',
      baseText: 'AB',
      workingText: 'AXB',
      reviewedAt: '2026-06-11',
    });
    expect(out).toContain('A{++X++}B');
    expect(out).toContain('changes: "削除0・追記1・指示0"');
  });

  test('language=en で英語の読み取りルールを出す', () => {
    const out = assembleReviewFile({
      baseFileName: 'draft.md',
      baseText: 'Old text.',
      workingText: '{--Old--}{++New++} text.',
      reviewedAt: '2026-06-11',
      globalNote: 'Keep it short.',
      language: 'en',
    });
    expect(out).toContain('changes: "delete 1, add 1, instruction 1"');
    expect(out).not.toContain('# Review Summary (AI reads this first)');
    expect(out).not.toContain('【Delete】');
    expect(out).toContain('- `Global instruction` applies to the whole body. Check it before individual marks.');
    expect(out).toContain('# Reading guide for AI (CriticMarkup)');
    expect(out).toContain('# Body (full text with edits in CriticMarkup)');
  });

  test('整合性が壊れる入力なら IntegrityError がそのまま伝播する（黙って保存しない）', () => {
    expect(() =>
      assembleReviewFile({
        baseFileName: 'a.md',
        baseText: '',
        workingText: 'C++}',
        reviewedAt: '2026-06-11',
      }),
    ).toThrow(IntegrityError);
  });
});

describe('assembleReviewFile（入力ガード）', () => {
  test('reviewedAt が YYYY-MM-DD でなければ TypeError', () => {
    expect(() =>
      assembleReviewFile({
        baseFileName: 'a.md',
        baseText: 'A',
        workingText: 'A',
        reviewedAt: '今日',
      }),
    ).toThrow(TypeError);
  });

  test('ファイル名の改行は frontmatter でエスケープされる（行注入防止）', () => {
    const out = assembleReviewFile({
      baseFileName: 'a\nb.md',
      baseText: 'A',
      workingText: 'A',
      reviewedAt: '2026-06-11',
    });
    expect(out).toContain('base: "a\\nb.md"');
  });
});
