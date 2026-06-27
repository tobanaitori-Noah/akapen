import path from 'node:path';

/**
 * base の隣に置くレビューファイルのパスを返す（計画2 Task 6）。
 * - 拡張子が `.md`（大文字小文字無視＝ `.MD` / `.Md` も対象）なら `<base名>.akapen.md` に差し替え
 * - それ以外の拡張子は事故防止のため末尾に `.akapen.md` を付加
 * 純関数（fs 非依存）。
 */
export function reviewPathFor(basePath: string): string {
  const ext = path.extname(basePath);
  if (ext.toLowerCase() === '.md') {
    return `${basePath.slice(0, -ext.length)}.akapen.md`;
  }
  return `${basePath}.akapen.md`;
}
