import fs from 'node:fs';

/**
 * レビュー書込み（計画2 Task 6）。
 * fs エラー（EACCES / EROFS / ENOSPC 等）を throw せず {status:'error', message} に正規化
 * ＝renderer へ例外を漏らさない（ダイアログ表示の保証）。
 */
export type WriteReviewResult =
  | { status: 'saved'; path: string }
  | { status: 'error'; message: string };

export function writeReviewContent(targetPath: string, content: string): WriteReviewResult {
  try {
    fs.writeFileSync(targetPath, content, 'utf8');
    return { status: 'saved', path: targetPath };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
