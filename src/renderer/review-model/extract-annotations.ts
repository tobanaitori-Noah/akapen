import type { MarkupNode } from "@akapen/markup";
import type { ReviewAnnotation } from "./types.js";
import { generateAnnotationId } from "./annotation-store.js";

/**
 * parseCritic(bodyMd) の出力から ReviewAnnotation[] を生成する。
 * base document の offset を追跡し、各 annotation に TextAnchor を付与。
 */
export function extractAnnotationsFromNodes(
  nodes: readonly MarkupNode[],
): ReviewAnnotation[] {
  const annotations: ReviewAnnotation[] = [];
  let baseOffset = 0;
  const now = Date.now();
  const isInsertionSeparator = (text: string): boolean =>
    text.includes("\n") && text.trim().length === 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    switch (node.kind) {
      case "text":
        baseOffset += node.text.length;
        break;

      case "deletion":
        annotations.push({
          id: generateAnnotationId(),
          type: "deletion",
          anchor: {
            baseOffset,
            baseLength: node.text.length,
            quote: node.text,
          },
          deletedText: node.text,
          source: "preview",
          createdAt: now,
        });
        baseOffset += node.text.length;
        break;

      case "insertion":
        {
          let text = node.text;
          let j = i + 1;
          while (
            nodes[j]?.kind === "text" &&
            isInsertionSeparator(nodes[j]!.text) &&
            nodes[j + 1]?.kind === "insertion"
          ) {
            text += nodes[j]!.text + nodes[j + 1]!.text;
            j += 2;
          }
          i = j - 1;
          annotations.push({
            id: generateAnnotationId(),
            type: "insertion",
            anchor: {
              baseOffset,
              baseLength: 0,
              quote: "",
            },
            text,
            source: "preview",
            createdAt: now,
          });
        }
        break;

      case "highlight": {
        const next = nodes[i + 1];
        if (next?.kind === "comment") {
          annotations.push({
            id: generateAnnotationId(),
            type: "comment",
            anchor: {
              baseOffset,
              baseLength: node.text.length,
              quote: node.text,
            },
            quotedText: node.text,
            instruction: next.text,
            createdAt: now,
          });
          i++;
        }
        baseOffset += node.text.length;
        break;
      }

      case "comment":
        break;
    }
  }

  return annotations;
}

/**
 * annotations の baseOffset を baseOriginal の実位置に再マッピングする。
 * getMarkdown() の正規化（空行追加等）で offset がズレた annotation を修正。
 * quote テキストで baseOriginal 内を検索し、見つかった位置に更新する。
 */
export function reanchorToBase(
  annotations: ReviewAnnotation[],
  baseOriginal: string,
): ReviewAnnotation[] {
  return annotations.map((a) => {
    if (a.type === "format-change") return a;
    const quote = a.anchor.quote;
    if (!quote) return a;
    const current = Math.max(0, Math.min(a.anchor.baseOffset, baseOriginal.length));
    if (baseOriginal.slice(current, current + quote.length) === quote) {
      return a;
    }
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let cursor = baseOriginal.indexOf(quote);
    while (cursor !== -1) {
      const distance = Math.abs(cursor - current);
      if (distance < bestDistance) {
        best = cursor;
        bestDistance = distance;
      }
      cursor = baseOriginal.indexOf(quote, cursor + Math.max(1, quote.length));
    }
    if (best === -1) return a;
    return { ...a, anchor: { ...a.anchor, baseOffset: best } };
  });
}
