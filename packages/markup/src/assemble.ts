import { parseCritic } from './parse.js';
import { reconcile } from './reconcile.js';
import { buildCriticMarkupReadingGuide, countChanges } from './summary.js';
import { operationsToCritic } from './operations-to-critic.js';
import type { Operations } from './operations-to-critic.js';

export interface AssembleInput {
  baseFileName: string; // 例: draft.md（フルパスでなくファイル名）
  baseText: string;     // 元原稿の中身（baseRaw・不変）
  /**
   * v1.5+ Operations List 経由の書き出し（plan18 新仕様）。
   * operations が渡されれば operationsToCritic を先に使い body を生成する。
   * operations が省略された場合は workingText + reconcile の旧パスにフォールバック
   * （v1.4 互換・phase 移行期の補助）。
   */
  operations?: Operations;
  /**
   * v1.4 互換フォールバック用。
   * operations が存在する場合は参照されない。
   */
  workingText?: string;
  reviewedAt: string;   // YYYY-MM-DD（呼び出し側が渡す）
  globalNote?: string;  // 全体指示欄
  language?: 'ja' | 'en';
}

const yamlStr = (s: string): string =>
  `"${s
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')}"`;

const normalizeLanguage = (language: AssembleInput['language']): 'ja' | 'en' =>
  language === 'en' ? 'en' : 'ja';

const changesSummary = (
  c: ReturnType<typeof countChanges>,
  language: 'ja' | 'en',
): string =>
  language === 'en'
    ? `delete ${c.deletion}, add ${c.insertion}, instruction ${c.comment}`
    : `削除${c.deletion}・追記${c.insertion}・指示${c.comment}`;

/**
 * `.akapen.md` 書き出し文字列を組み立てる。
 *
 * ### body の組み立て優先順位
 * 1. `input.operations` が存在 → `operationsToCritic(baseText, operations)` で直接生成（v1.5+ 新仕様）
 * 2. `input.workingText` が存在 → `reconcile(baseText, workingText)` にフォールバック（v1.4 互換）
 * 3. どちらもなし → `baseText` をそのまま body とする（操作なし）
 *
 * IntegrityError は呼び出し元にそのまま伝播する。
 */
export function assembleReviewFile(input: AssembleInput): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedAt)) {
    throw new TypeError(`reviewedAt must be YYYY-MM-DD, got: ${JSON.stringify(input.reviewedAt)}`);
  }

  let body: string;
  if (input.operations !== undefined) {
    // v1.5+ 新仕様: operations → CriticMarkup を一意に変換（冪等）
    body = operationsToCritic(input.baseText, input.operations);
  } else if (input.workingText !== undefined) {
    // v1.4 互換フォールバック: reconcile が IntegrityError を投げることがある
    body = reconcile(input.baseText, input.workingText);
  } else {
    // 操作なし: baseText をそのまま使用
    body = input.baseText;
  }

  const nodes = parseCritic(body);
  const language = normalizeLanguage(input.language);
  const c = countChanges(nodes, input.globalNote);
  return [
    '---',
    `base: ${yamlStr(input.baseFileName)}`,
    `reviewed_at: ${yamlStr(input.reviewedAt)}`,
    `changes: ${yamlStr(changesSummary(c, language))}`,
    `generator: ${yamlStr('AkaPen v1')}`,
    '---',
    '',
    buildCriticMarkupReadingGuide(nodes, {
      globalNote: input.globalNote,
      baseText: input.baseText,
      language,
    }),
    '',
    '---',
    '',
    language === 'en' ? '# Body (full text with edits in CriticMarkup)' : '# 本文（添削入り全文・CriticMarkup 記法）',
    '',
    body,
    '',
  ].join('\n');
}
