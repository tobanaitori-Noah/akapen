/**
 * displayed-position.ts — displayedPositionToDerived（plan21 T12 C1 で shared に移管）
 *
 * ## 責務
 * `acceptAllForDisplay(derivedMd)` 上の位置 → derivedMd 上の位置 の変換のみ。
 *
 * ## 移管経緯（plan21 T12 C1・2026-06-18）
 * 旧所在: `app/src/renderer/editor/derive.ts`（plan19 T12・MEDIUM-1 で source-edit-bridge
 * から derive.ts に正式 export として移管された関数）。
 * plan21 T12 で shared パッケージへ機械的に移管（実装ロジック不変）。
 * app/src/renderer/editor/derive.ts は re-export のみで互換性を維持する。
 */

// CriticMarkup タグ定数（displayedPositionToDerived 内部参照用・derive.ts の同名定数と
// 同値だが、shared 側で自己完結させるためここでも持つ）
const OPEN_DELETION = '{--';
const CLOSE_DELETION = '--}';
const OPEN_INSERTION = '{++';
const CLOSE_INSERTION = '++}';

/**
 * `acceptAllForDisplay(derivedMd)` 上の位置 → derivedMd 上の位置 を変換する。
 *
 * acceptAllForDisplay は以下の変換を行う：
 *   - `{--…--}`（nested 含む）→ 完全に削除
 *   - `{++text++}` → 中身（`{++` と `++}` の 6 文字を除去）
 *   - `{==…==}{>>…<<}` → そのまま
 *
 * displayedText を構築する過程と同型のスタック走査で、displayedText の各位置に
 * 対応する derivedMd 位置を計算する。
 *
 * ## アルゴリズム
 *
 * derivedMd を 1 文字ずつ走査し、
 *   - 削除マーク内（depth > 0）の文字は displayedCursor を進めない
 *   - `{++` / `++}` のマーカーは displayedCursor を進めない（除去される）
 *   - それ以外の文字は displayedCursor を 1 進める
 *
 * displayedCursor === target に到達した時点で derivedCursor を返す。
 *
 * @param derivedMd  - 現状の derivedMd（applyOperations の出力）
 * @param displayedPos - displayedText 上の位置（0 〜 displayedText.length）
 * @returns derivedMd 上の対応位置
 */
export function displayedPositionToDerived(derivedMd: string, displayedPos: number): number {
  if (displayedPos <= 0) return 0;
  if (derivedMd.length === 0) return 0;

  let derivedCursor = 0;
  let displayedCursor = 0;
  let deletionDepth = 0;

  while (derivedCursor < derivedMd.length) {
    if (displayedCursor >= displayedPos) {
      return derivedCursor;
    }

    // 削除マークの開閉判定（深さを追う・nested 対応）
    if (derivedMd.startsWith(OPEN_DELETION, derivedCursor)) {
      deletionDepth++;
      derivedCursor += OPEN_DELETION.length;
      continue;
    }
    if (deletionDepth > 0 && derivedMd.startsWith(CLOSE_DELETION, derivedCursor)) {
      deletionDepth--;
      derivedCursor += CLOSE_DELETION.length;
      continue;
    }
    if (deletionDepth > 0) {
      // 削除マーク内の文字は displayedText に出ない
      derivedCursor++;
      continue;
    }

    // 追記マークの開閉（中身は残るが `{++` / `++}` 自体は除去される）
    if (derivedMd.startsWith(OPEN_INSERTION, derivedCursor)) {
      derivedCursor += OPEN_INSERTION.length;
      continue;
    }
    if (derivedMd.startsWith(CLOSE_INSERTION, derivedCursor)) {
      derivedCursor += CLOSE_INSERTION.length;
      continue;
    }

    // それ以外の 1 文字（コメントマークも含む＝acceptAllForDisplay はコメントを残す）
    derivedCursor++;
    displayedCursor++;
  }

  // displayedPos が末尾以降を指している場合は derivedMd の末尾を返す
  return derivedMd.length;
}
