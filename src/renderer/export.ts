/**
 * 完了フロー（書き出し内容の組み立て）。
 *
 * plan30 Phase 3: PM doc の serialized markdown（既に CriticMarkup 含む）を
 * そのまま body として使い、frontmatter + summary を付けて .akapen.md を生成する。
 * v4 の operationsToCritic / reconcile パイプラインは不要。
 *
 * 純関数＝ハーネス/ランナーから直接検証できる（C17/C18）。
 */
import { acceptView, parseCritic } from "@akapen/markup";
import { buildCriticMarkupReadingGuide, buildSummary, countChanges } from "@akapen/markup";

export function normalizeSplitInsertionBreaksForExport(md: string): string {
  let normalized = md;
  for (let i = 0; i < 20; i++) {
    const next = normalized.replace(
      /\{\+\+([\s\S]*?)\+\+\}((?:[ \t]*\r?\n)+[ \t]*)\{\+\+([\s\S]*?)\+\+\}/g,
      "{++$1$2$3++}",
    );
    if (next === normalized) return normalized;
    normalized = next;
  }
  return normalized;
}

const yamlStr = (s: string): string =>
  `"${s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}"`;

export interface BuildReviewInput {
  baseOriginal: string;
  bodyMd: string;
  globalNote: string;
  baseFileName: string;
  reviewedAt: string;
}

export function buildReviewContent(state: BuildReviewInput): {
  content: string;
  acceptedBodyIsEmpty: boolean;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.reviewedAt)) {
    throw new TypeError(
      `reviewedAt must be YYYY-MM-DD, got: ${JSON.stringify(state.reviewedAt)}`,
    );
  }

  const bodyMd = normalizeSplitInsertionBreaksForExport(state.bodyMd);
  const nodes = parseCritic(bodyMd);
  const hasCriticMarks = nodes.some((n) => n.kind !== "text");
  const unchanged = !hasCriticMarks;
  const body = unchanged ? state.baseOriginal : bodyMd;

  const c = countChanges(nodes, state.globalNote);

  const content = [
    "---",
    `base: ${yamlStr(state.baseFileName)}`,
    `reviewed_at: ${yamlStr(state.reviewedAt)}`,
    `changes: ${yamlStr(`削除${c.deletion}・追記${c.insertion}・指示${c.comment}`)}`,
    `generator: ${yamlStr("AkaPen v1")}`,
    "---",
    "",
    "# レビューサマリ（AI はまずここを読む）",
    "",
    unchanged
      ? "変更なし"
      : buildSummary(nodes, { globalNote: state.globalNote, baseText: state.baseOriginal }),
    "",
    "---",
    "",
    buildCriticMarkupReadingGuide(nodes, {
      globalNote: state.globalNote,
      baseText: state.baseOriginal,
    }),
    "",
    "---",
    "",
    "# 本文（添削入り全文・CriticMarkup 記法）",
    "",
    body,
    "",
  ].join("\n");

  const acceptedBodyIsEmpty = acceptView(parseCritic(body)).trim() === "";
  return { content, acceptedBodyIsEmpty };
}

/** reviewedAt 用のローカル日付 YYYY-MM-DD（getFullYear/getMonth/getDate から組む＝UTC ずれ防止） */
export function localReviewDate(now = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}
