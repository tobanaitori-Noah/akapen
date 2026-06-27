/**
 * v1.1.2: 空リスト項目の `<br />` 正規化（narrow canonicalizer）。
 *
 * 真因: Milkdown commonmark の remarkPreserveEmptyLine プラグインが
 * 「空の非末尾 paragraph（Enter で作った空リスト項目含む）」を
 * `<br />` HTML としてシリアライズする。原文に `* <br />` が現れると
 * reconcile/流し込みで critic 構造と絡み忠実性検査が loud stop になる。
 *
 * 対象: 行全体が「リストマーカー or 引用マーカー」＋ 任意空白 ＋ `<br />` だけの行。
 * 処理: そのパターンの行を行ごと削除する（空のリスト項目は内容的に変更0＝削除が安全）。
 *       削除後に空行が3行以上連続する場合は2行（段落区切り1つ）に圧縮する。
 *
 * ⚠️ 対象はこのパターンの行だけ:
 *   - 任意の HTML 要素（`<br />` 以外）には適用しない
 *   - 本文テキストには触れない
 *   - lazy continuation 行に空行を自動挿入しない
 *   - <br> / <br/> の揺れも正規化対象に含む（`<br />` との同一視）
 */

/**
 * `* <br />` 等の空リスト・引用行を行ごと除去する。
 *
 * マッチ対象:
 *   - `* <br />` / `- <br />` / `+ <br />`（順序なし）
 *   - `1. <br />` / `2. <br />` 等（順序付き）
 *   - `> <br />`（引用）
 *   - prefix の直後に空白0個以上 + `<br>` / `<br/>` / `<br />` のみの行
 *   - インデント付き（2スペース・4スペース・タブ）のネスト項目も対象
 *
 * 返値: 正規化後の md 文字列。変更がなければ入力と同一の文字列参照を返す。
 */
export function canonicalizeBrLines(md: string): string {
  // パターン: 行頭 + 任意インデント + (箇条書きマーカー | 順序付きマーカー | 引用マーカー)
  //           + 任意空白 + <br> / <br/> / <br /> + 行末空白 + 改行（あれば）
  // 行ごと削除する（空リスト項目は内容的に変更0＝削除が安全）。
  const RE = /^[ \t]*(?:[*\-+]|\d+\.)\s+<br\s*\/?\s*>[ \t]*(?:\n|$)/gm;
  let result = md.replace(RE, "");

  // Milkdown/remark が hard break や空白保持として出す表示用記号は source に出さない。
  // Shift+Enter は list item continuation として扱うため、行末 `\` に依存しない。
  result = result.replace(/\\[ \t]*(?=\n|$)/g, "");
  result = result.replace(/&#x20;/g, " ");
  result = result.replace(/^[ \t]+$/gm, "");

  // remark-stringify のエスケープ除去: `\#` `\-` `\>` `\*` `\+` 等の行頭マーカーエスケープ。
  // 原文がプレーンテキスト（heading/list でない）でも serializer が念のためエスケープする問題。
  result = result.replace(/\\([#\-*+>])/g, "$1");

  // standalone `<br />` 行を除去（空段落の残骸）。
  result = result.replace(/^[ \t]*<br\s*\/?\s*>[ \t]*$/gm, "");

  // loose list → tight list: リスト/サブリスト項目の前の空行を詰める。
  // ネストされたリスト（ordered `1.` 含む）にも対応するため繰り返し適用。
  // インデントされたコンテンツ行（サブリスト・continuation）の前の空行も除去。
  let prev: string;
  do {
    prev = result;
    result = result.replace(/([^\n])\n\n(?=[ \t]*(?:[-*+]|\d+\.) )/g, "$1\n");
    // インデントされた continuation 行（リスト内の折り返し）の前の空行も除去
    result = result.replace(/([^\n])\n\n(?=[ \t]{2,}\S)/g, "$1\n");
  } while (result !== prev);

  // 水平線 `---` / `***` / `___` 前の余分な空行を除去（1行分は保持）
  result = result.replace(/\n{3,}(?=[-*_]{3,}$)/gm, "\n\n");

  // 連続空行を段落区切り1つに圧縮。
  result = result.replace(/\n{3,}/g, "\n\n");

  // serializer が文書末尾にだけ付ける改行は、往復安定性のため本文差分にしない。
  if (result.endsWith("\n")) result = result.slice(0, -1);

  return result;
}
