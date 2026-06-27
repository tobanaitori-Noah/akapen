import type { ReviewAnnotation } from "./types.js";

const EMPTY_CRITIC_COMMENT_RE =
  /\{==\s*==\}\{>>[\s\S]*?<<\}|\{==[\s\S]*?==\}\{>>\s*<<\}/g;
const EMPTY_CRITIC_TOKEN_RE =
  /\{--\s*--\}|\{\+\+\+\+\}|\{==\s*==\}|\{>>\s*<<\}/g;

export interface CriticProjectionSegment {
  kind: "base" | "insertion" | "deletion" | "comment" | "markup";
  sourceFrom: number;
  sourceTo: number;
  baseOffset: number;
  baseLength: number;
  annotationId?: string;
}

export interface CriticProjection {
  md: string;
  segments: CriticProjectionSegment[];
}

export function sanitizeEmptyCriticMarkup(md: string): string {
  let current = md;
  for (let i = 0; i < 20; i++) {
    const next = current
      .replace(EMPTY_CRITIC_COMMENT_RE, "")
      .replace(EMPTY_CRITIC_TOKEN_RE, "");
    if (next === current) return next;
    current = next;
  }
  return current;
}

function readCriticTokenInsideDeletionBody(
  md: string,
  start: number,
): { text: string; end: number } | null {
  if (md.startsWith("{--", start)) {
    const nested = readDeletionToken(md, start);
    if (nested) {
      return { text: nested.token.slice(3, -3), end: nested.end };
    }
  }
  if (md.startsWith("{++", start)) {
    const end = md.indexOf("++}", start + 3);
    if (end !== -1) {
      return { text: md.slice(start + 3, end), end: end + 3 };
    }
  }
  if (md.startsWith("{==", start)) {
    const quoteEnd = md.indexOf("==}", start + 3);
    if (quoteEnd !== -1) {
      let end = quoteEnd + 3;
      if (md.startsWith("{>>", end)) {
        const instructionEnd = md.indexOf("<<}", end + 3);
        if (instructionEnd !== -1) {
          end = instructionEnd + 3;
        }
      }
      return { text: md.slice(start + 3, quoteEnd), end };
    }
  }
  if (md.startsWith("{>>", start)) {
    const end = md.indexOf("<<}", start + 3);
    if (end !== -1) {
      return { text: "", end: end + 3 };
    }
  }
  return null;
}

function sanitizeDeletionBodyCriticMarkup(md: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < md.length) {
    const token = readCriticTokenInsideDeletionBody(md, cursor);
    if (token) {
      result += token.text;
      cursor = token.end;
      continue;
    }
    result += md[cursor]!;
    cursor += 1;
  }
  return result;
}

function readDeletionToken(
  md: string,
  start: number,
): { token: string; end: number } | null {
  if (!md.startsWith("{--", start)) return null;
  let cursor = start + 3;
  let body = "";
  while (cursor < md.length) {
    const token = readCriticTokenInsideDeletionBody(md, cursor);
    if (token) {
      body += token.text;
      cursor = token.end;
      continue;
    }
    if (md.startsWith("--}", cursor)) {
      return {
        token: `{--${body}--}`,
        end: cursor + 3,
      };
    }
    body += md[cursor]!;
    cursor += 1;
  }
  return null;
}

export function sanitizeNestedCriticMarkup(md: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < md.length) {
    if (md.startsWith("{--", cursor)) {
      const deletion = readDeletionToken(md, cursor);
      if (deletion) {
        result += deletion.token;
        cursor = deletion.end;
        continue;
      }
    }
    result += md[cursor]!;
    cursor += 1;
  }
  return result;
}

function sortAnnotations(
  annotations: readonly ReviewAnnotation[],
): Array<Exclude<ReviewAnnotation, { type: "format-change" }>> {
  return annotations
    .filter(
      (a): a is Exclude<ReviewAnnotation, { type: "format-change" }> =>
        a.type !== "format-change",
    )
    .filter((a) => {
      switch (a.type) {
        case "deletion":
          return a.deletedText.trim().length > 0 && a.anchor.baseLength > 0;
        case "insertion":
          return a.text.length > 0;
        case "comment":
          return (
            a.quotedText.trim().length > 0 &&
            a.instruction.trim().length > 0 &&
            a.anchor.baseLength > 0
          );
      }
    })
    .sort((a, b) => a.anchor.baseOffset - b.anchor.baseOffset);
}

type ProjectableAnnotation = Exclude<
  ReviewAnnotation,
  { type: "format-change" }
>;

function rangesOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

function normalizeOverlappingDeletions(
  baseMd: string,
  annotations: readonly ProjectableAnnotation[],
): ProjectableAnnotation[] {
  const deletionRanges = annotations
    .filter((a): a is Extract<ProjectableAnnotation, { type: "deletion" }> =>
      a.type === "deletion",
    )
    .map((a) => ({
      annotation: a,
      from: a.anchor.baseOffset,
      to: a.anchor.baseOffset + a.anchor.baseLength,
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  if (deletionRanges.length <= 1) return [...annotations];

  const merged: Array<{
    annotation: Extract<ProjectableAnnotation, { type: "deletion" }>;
    from: number;
    to: number;
  }> = [];
  for (const range of deletionRanges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
      continue;
    }
    merged.push({ ...range });
  }

  const normalizedDeletions = merged.map(({ annotation, from, to }) => {
    const deletedText = baseMd.slice(from, to);
    return {
      ...annotation,
      anchor: {
        ...annotation.anchor,
        baseOffset: from,
        baseLength: deletedText.length,
        quote: deletedText,
      },
      deletedText,
    };
  });

  const normalizedDeletionRanges = normalizedDeletions.map((a) => ({
    from: a.anchor.baseOffset,
    to: a.anchor.baseOffset + a.anchor.baseLength,
  }));

  const remaining = annotations.filter((a) => {
    if (a.type === "deletion") return false;
    if (a.type === "insertion") {
      return !normalizedDeletionRanges.some(
        (range) =>
          a.anchor.baseOffset > range.from && a.anchor.baseOffset < range.to,
      );
    }
    return !normalizedDeletionRanges.some((range) =>
      rangesOverlap(
        a.anchor.baseOffset,
        a.anchor.baseOffset + a.anchor.baseLength,
        range.from,
        range.to,
      ),
    );
  });

  return [...normalizedDeletions, ...remaining].sort((a, b) => {
    const byOffset = a.anchor.baseOffset - b.anchor.baseOffset;
    if (byOffset !== 0) return byOffset;
    const order: Record<ProjectableAnnotation["type"], number> = {
      deletion: 0,
      comment: 1,
      insertion: 2,
    };
    return order[a.type] - order[b.type];
  });
}

function sourceLineAt(baseMd: string, baseOffset: number): {
  start: number;
  end: number;
  line: string;
} {
  const bounded = Math.max(0, Math.min(baseOffset, baseMd.length));
  const lineStart = baseMd.lastIndexOf("\n", Math.max(0, bounded - 1)) + 1;
  const lineEndIndex = baseMd.indexOf("\n", bounded);
  const lineEnd = lineEndIndex === -1 ? baseMd.length : lineEndIndex;
  return {
    start: lineStart,
    end: lineEnd,
    line: baseMd.slice(lineStart, lineEnd),
  };
}

function markdownStructuralPrefixEnd(line: string): number {
  const heading = /^(#{1,6}\s+)/.exec(line);
  if (heading) return heading[1]!.length;
  const list = /^(\s{0,3}(?:[-*+]|\d+[.)])\s+)/.exec(line);
  if (list) return list[1]!.length;
  const quote = /^(\s{0,3}>\s*)/.exec(line);
  if (quote) return quote[1]!.length;
  const thematic = /^(\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*)$/.exec(line);
  if (thematic) return thematic[1]!.length;
  return 0;
}

function safeInsertionOffset(baseMd: string, baseOffset: number): number {
  const { start, end, line } = sourceLineAt(baseMd, baseOffset);
  if (baseOffset < start || baseOffset > end) return baseOffset;
  const prefixEnd = markdownStructuralPrefixEnd(line);
  if (prefixEnd === 0) return baseOffset;
  const safeOffset = start + prefixEnd;
  return baseOffset < safeOffset ? safeOffset : baseOffset;
}

function normalizeInsertionAnchors(
  baseMd: string,
  annotations: readonly ReviewAnnotation[],
): ReviewAnnotation[] {
  return annotations.map((annotation) => {
    if (annotation.type !== "insertion") return annotation;
    const baseOffset = safeInsertionOffset(baseMd, annotation.anchor.baseOffset);
    if (baseOffset === annotation.anchor.baseOffset) return annotation;
    return {
      ...annotation,
      anchor: {
        ...annotation.anchor,
        baseOffset,
      },
    };
  });
}

function startsWithMarkdownBlockMarker(text: string): boolean {
  return /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?|(?:-{3,}|\*{3,}|_{3,})[ \t]*$)/.test(
    text,
  );
}

/**
 * AnnotationStore の annotations + base markdown から CriticMarkup 入り markdown を生成。
 * base に対して annotations を位置順に適用。
 */
export function buildCriticProjection(
  baseMd: string,
  annotations: readonly ReviewAnnotation[],
): CriticProjection {
  const sorted = normalizeOverlappingDeletions(
    baseMd,
    sortAnnotations(normalizeInsertionAnchors(baseMd, annotations)),
  );
  if (sorted.length === 0) {
    return {
      md: baseMd,
      segments:
        baseMd.length > 0
          ? [
              {
                kind: "base",
                sourceFrom: 0,
                sourceTo: baseMd.length,
                baseOffset: 0,
                baseLength: baseMd.length,
              },
            ]
          : [],
    };
  }

  const parts: string[] = [];
  const segments: CriticProjectionSegment[] = [];
  let sourceCursor = 0;
  let cursor = 0;
  let i = 0;

  const append = (
    text: string,
    kind: CriticProjectionSegment["kind"],
    baseOffset: number,
    baseLength: number,
    annotationId?: string,
  ): void => {
    if (text.length === 0) return;
    const sourceFrom = sourceCursor;
    const sourceTo = sourceCursor + text.length;
    parts.push(text);
    segments.push({
      kind,
      sourceFrom,
      sourceTo,
      baseOffset,
      baseLength,
      annotationId,
    });
    sourceCursor = sourceTo;
  };

  const lastOutputLineHasCriticMarkup = (): boolean => {
    const current = parts.join("");
    const lineStart = current.lastIndexOf("\n") + 1;
    return /\{--|\{\+\+|\{==|\{>>/.test(current.slice(lineStart));
  };

  const startsWithThematicBreakBoundary = (text: string): boolean =>
    /^(?:[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\n|$)|[ \t]*\n[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*(?:\n|$))/.test(
      text,
    );

  const ensureBlockBoundaryBeforeBaseSlice = (
    baseOffset: number,
    text: string,
  ): void => {
    if (!startsWithThematicBreakBoundary(text)) return;
    if (!lastOutputLineHasCriticMarkup()) return;
    const current = parts.join("");
    if (current.length === 0 || current.endsWith("\n\n")) return;
    append("\n", "markup", baseOffset, 0);
  };

  const appendBase = (from: number, to: number): void => {
    if (to <= from) return;
    const text = baseMd.slice(from, to);
    ensureBlockBoundaryBeforeBaseSlice(from, text);
    append(text, "base", from, to - from);
  };

  const ensureBlockBoundaryBeforeStructuralDeletion = (baseOffset: number): void => {
    const current = parts.join("");
    if (current.length === 0 || current.endsWith("\n\n")) return;
    if (current.endsWith("\n")) {
      const previousContentLine = current
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .at(-1)
        ?.trim();
      if (/^\{--[\s\S]*--\}$/.test(previousContentLine ?? "")) return;
      append("\n", "markup", baseOffset, 0);
    }
  };

  const appendDeletion = (
    annotation: Extract<ProjectableAnnotation, { type: "deletion" }>,
  ): void => {
    const deletedText = annotation.deletedText;
    let local = 0;
    while (local < deletedText.length) {
      const newline = deletedText.indexOf("\n", local);
      const lineEnd = newline < 0 ? deletedText.length : newline;
      const line = deletedText.slice(local, lineEnd);
      if (line.length > 0) {
        append("{--", "markup", cursor + local, 0);
        append(
          sanitizeDeletionBodyCriticMarkup(line),
          "deletion",
          cursor + local,
          line.length,
          annotation.id,
        );
        append("--}", "markup", cursor + lineEnd, 0);
      }
      if (newline < 0) break;
      append("\n", "deletion", cursor + lineEnd, 1, annotation.id);
      local = newline + 1;
    }
  };

  const appendInsertion = (
    annotation: Extract<ProjectableAnnotation, { type: "insertion" }>,
  ): void => {
    append("{++", "markup", annotation.anchor.baseOffset, 0);
    append(
      annotation.text,
      "insertion",
      annotation.anchor.baseOffset,
      0,
      annotation.id,
    );
    append("++}", "markup", annotation.anchor.baseOffset, 0);
  };

  while (i < sorted.length) {
    const offset = sorted[i].anchor.baseOffset;

    if (offset > cursor) {
      appendBase(cursor, offset);
      cursor = offset;
    }

    const atOffset: typeof sorted = [];
    let j = i;
    while (j < sorted.length && sorted[j].anchor.baseOffset === offset) {
      atOffset.push(sorted[j]);
      j++;
    }

    atOffset.sort((a, b) => {
      const order: Record<string, number> = {
        deletion: 0,
        comment: 1,
        insertion: 2,
      };
      return (order[a.type] ?? 3) - (order[b.type] ?? 3);
    });

    for (const a of atOffset) {
      switch (a.type) {
        case "deletion":
          if (startsWithMarkdownBlockMarker(a.deletedText)) {
            ensureBlockBoundaryBeforeStructuralDeletion(cursor);
          }
          appendDeletion(a);
          cursor += a.anchor.baseLength;
          break;
        case "insertion":
          appendInsertion(a);
          break;
        case "comment":
          append("{==", "markup", cursor, 0);
          append(
            a.quotedText,
            "comment",
            cursor,
            a.anchor.baseLength,
            a.id,
          );
          append(
            `==}{>>${a.instruction}<<}`,
            "markup",
            cursor + a.anchor.baseLength,
            0,
          );
          cursor += a.anchor.baseLength;
          break;
      }
    }

    i = j;
  }

  if (cursor < baseMd.length) {
    appendBase(cursor, baseMd.length);
  }

  return { md: parts.join(""), segments };
}

export function buildCriticMarkup(
  baseMd: string,
  annotations: readonly ReviewAnnotation[],
): string {
  return sanitizeEmptyCriticMarkup(buildCriticProjection(baseMd, annotations).md);
}

export function toPmSafeCriticMarkdown(md: string): string {
  return md.replace(/\{\+\+([\s\S]*?)\+\+\}/g, (_token, body: string) => {
    if (!body.includes("\n")) return `{++${body}++}`;
    return body
      .split(/(\r?\n+)/)
      .map((chunk) => {
        if (chunk.length === 0) return "";
        if (/\r?\n+/.test(chunk)) return chunk;
        return `{++${chunk}++}`;
      })
      .join("");
  });
}
