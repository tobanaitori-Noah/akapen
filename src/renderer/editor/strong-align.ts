/**
 * strong-align.ts — critic-aware な markdown 太字収集ユーティリティ。
 * plan30 v5: unboldExistingStrong 等の v4 ヘルパは廃止。
 * collectMdStrong のみ残す（e2e harness で使用）。
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { criticMdast, criticMicromark } from "./critic-micromark";

export interface MdStrong {
  text: string;
  start: number;
  end: number;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
}

/**
 * markdown を critic-aware に解析し、strong ノードを出現順に集める。
 * critic マーク内部の `**` は atomic トークンとして消費され、幽霊 strong にならない。
 */
export function collectMdStrong(workingMd: string): MdStrong[] {
  let tree: ReturnType<typeof fromMarkdown>;
  try {
    tree = fromMarkdown(workingMd, {
      extensions: [criticMicromark()],
      mdastExtensions: [criticMdast()],
    });
  } catch (e) {
    console.warn("[strong-align] fromMarkdown failed; returning empty", e);
    return [];
  }
  const out: MdStrong[] = [];
  const walk = (node: unknown): void => {
    const n = node as {
      type?: string;
      children?: unknown[];
      position?: { start: { offset: number }; end: { offset: number } };
    };
    if (
      n.type === "criticInsertion" ||
      n.type === "criticDeletion" ||
      n.type === "criticHighlight" ||
      n.type === "criticComment"
    )
      return;
    if (n.type === "strong" && n.position) {
      const start = n.position.start.offset;
      const end = n.position.end.offset;
      const text = textOf(n);
      out.push({
        text,
        start,
        end,
        openFrom: start,
        openTo: start + 2,
        closeFrom: end - 2,
        closeTo: end,
      });
    }
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  };
  walk(tree);
  return out;
}

function textOf(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text" && typeof n.value === "string") return n.value;
  if (Array.isArray(n.children)) return n.children.map(textOf).join("");
  return "";
}
