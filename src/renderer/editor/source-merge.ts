/**
 * source-merge.ts — source モード編集の diff-based merge。
 *
 * source モードは {--...--} を strip した表示。ユーザーの編集を fullMd（CriticMarkup 入り）
 * に適用し、{--...--} ブロックを保持する。
 */
import { diffChars } from "diff";
import {
  generateAnnotationId,
  isValidReviewAnnotation,
} from "../review-model/annotation-store.js";
import type { CriticProjectionSegment } from "../review-model/export-critic.js";
import type {
  DeletionAnnotation,
  InsertionAnnotation,
  ReviewAnnotation,
} from "../review-model/types.js";

const DELETION_RE = /\{--[\s\S]*?--\}/g;

interface DeletionBlock {
  fullStart: number;
  fullEnd: number;
  strippedPos: number;
}

function findDeletionBlocks(fullMd: string): DeletionBlock[] {
  const blocks: DeletionBlock[] = [];
  let match: RegExpExecArray | null;
  let gap = 0;
  const re = new RegExp(DELETION_RE.source, "g");
  while ((match = re.exec(fullMd)) !== null) {
    blocks.push({
      fullStart: match.index,
      fullEnd: match.index + match[0].length,
      strippedPos: match.index - gap,
    });
    gap += match[0].length;
  }
  return blocks;
}

function strippedToFullPos(
  sPos: number,
  blocks: readonly DeletionBlock[],
): number {
  let offset = 0;
  for (const b of blocks) {
    if (sPos <= b.strippedPos) break;
    offset += b.fullEnd - b.fullStart;
  }
  return sPos + offset;
}

/**
 * source モードの編集を fullMd に merge する。
 *
 * @param fullMd - getMarkdown() の出力（CriticMarkup 入り）
 * @param strippedSnapshot - source に入った時の表示テキスト（{--...--} strip 済み）
 * @param editedMd - source モードで編集された現在のテキスト
 * @returns {--...--} を保持したまま編集を適用した markdown
 */
export function mergeSourceEditsWithDeletions(
  fullMd: string,
  strippedSnapshot: string,
  editedMd: string,
): string {
  if (editedMd === strippedSnapshot) return fullMd;

  const blocks = findDeletionBlocks(fullMd);

  // 共通 prefix / suffix で編集領域を特定
  let pre = 0;
  const preMax = Math.min(strippedSnapshot.length, editedMd.length);
  while (pre < preMax && strippedSnapshot[pre] === editedMd[pre]) {
    pre++;
  }

  let suf = 0;
  const sufMax = Math.min(strippedSnapshot.length - pre, editedMd.length - pre);
  while (
    suf < sufMax &&
    strippedSnapshot[strippedSnapshot.length - 1 - suf] ===
      editedMd[editedMd.length - 1 - suf]
  ) {
    suf++;
  }

  const inserted = editedMd.slice(pre, editedMd.length - suf);
  const removed = strippedSnapshot.slice(pre, strippedSnapshot.length - suf);

  const fullFrom = strippedToFullPos(pre, blocks);
  const fullTo = strippedToFullPos(strippedSnapshot.length - suf, blocks);

  // 編集領域内の {--...--} ブロックを抽出して保持
  const preserved: string[] = [];
  for (const b of blocks) {
    if (b.fullStart >= fullFrom && b.fullEnd <= fullTo) {
      preserved.push(fullMd.slice(b.fullStart, b.fullEnd));
    }
  }

  // source 編集はそのまま適用（CriticMarkup で囲まない）。
  // {--...--} 囲みは setMarkdown の lossy round-trip で壊れるため、
  // PM transactions による差分適用が必要（次セッションで設計）。
  return (
    fullMd.slice(0, fullFrom) +
    preserved.join("") +
    inserted +
    fullMd.slice(fullTo)
  );
}

export function stripDeletions(md: string): string {
  return md.replace(DELETION_RE, "");
}

export interface SourceProjection {
  md: string;
  segments: readonly CriticProjectionSegment[];
}

function cloneAnnotation(annotation: ReviewAnnotation): ReviewAnnotation {
  return {
    ...annotation,
    anchor: "anchor" in annotation ? { ...annotation.anchor } : undefined,
  } as ReviewAnnotation;
}

export function mapSourcePosToBaseOffset(
  projection: SourceProjection,
  sourcePos: number,
): number {
  const { segments } = projection;
  if (segments.length === 0) return 0;

  for (const segment of segments) {
    if (sourcePos < segment.sourceFrom) {
      return segment.baseOffset;
    }
    if (sourcePos <= segment.sourceTo) {
      if (
        segment.kind === "base" ||
        segment.kind === "deletion" ||
        segment.kind === "comment"
      ) {
        const local = Math.min(
          Math.max(sourcePos - segment.sourceFrom, 0),
          segment.baseLength,
        );
        return segment.baseOffset + local;
      }
      return segment.baseOffset;
    }
  }

  const last = segments[segments.length - 1]!;
  return last.baseOffset + last.baseLength;
}

function findInsertionSegmentAtPoint(
  projection: SourceProjection,
  sourcePos: number,
): CriticProjectionSegment | null {
  for (const segment of projection.segments) {
    if (segment.kind !== "insertion") continue;
    if (sourcePos >= segment.sourceFrom && sourcePos <= segment.sourceTo) {
      return segment;
    }
  }
  return null;
}

function getIntersectingSegments(
  projection: SourceProjection,
  from: number,
  to: number,
): CriticProjectionSegment[] {
  return projection.segments.filter(
    (segment) => from < segment.sourceTo && to > segment.sourceFrom,
  );
}

function addSourceInsertion(
  annotations: ReviewAnnotation[],
  text: string,
  baseOffset: number,
  createdAt: number,
): void {
  if (text.length === 0) return;
  annotations.push({
    id: generateAnnotationId(),
    type: "insertion",
    anchor: {
      baseOffset,
      baseLength: 0,
      quote: "",
    },
    text,
    source: "source",
    createdAt,
  } satisfies InsertionAnnotation);
}

function addSourceDeletion(
  annotations: ReviewAnnotation[],
  deletedText: string,
  baseOffset: number,
  createdAt: number,
): void {
  if (deletedText.trim().length === 0) return;

  let chunkStart = 0;
  for (let i = 0; i <= deletedText.length; i++) {
    const atBreak = i === deletedText.length || deletedText[i] === "\n";
    if (!atBreak) continue;
    if (i > chunkStart) {
      const chunk = deletedText.slice(chunkStart, i);
      if (chunk.trim().length === 0) {
        chunkStart = i + 1;
        continue;
      }
      annotations.push({
        id: generateAnnotationId(),
        type: "deletion",
        anchor: {
          baseOffset: baseOffset + chunkStart,
          baseLength: chunk.length,
          quote: chunk,
        },
        deletedText: chunk,
        source: "source",
        createdAt,
      } satisfies DeletionAnnotation);
    }
    chunkStart = i + 1;
  }
}

function spliceInsertionAnnotation(
  annotations: ReviewAnnotation[],
  annotationId: string,
  localFrom: number,
  localTo: number,
  insertedText: string,
): boolean {
  const index = annotations.findIndex((annotation) => annotation.id === annotationId);
  if (index === -1) return false;
  const annotation = annotations[index];
  if (!annotation || annotation.type !== "insertion") return false;

  const from = Math.max(0, Math.min(localFrom, annotation.text.length));
  const to = Math.max(from, Math.min(localTo, annotation.text.length));
  annotation.text =
    annotation.text.slice(0, from) + insertedText + annotation.text.slice(to);
  return true;
}

function shiftRepeatedLinePrefix(
  text: string,
  from: number,
  to: number,
): number {
  const lineStart = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const prefix = text.slice(lineStart, from);
  if (!/^(#{1,6} |[-*+] |\d+\. )$/.test(prefix)) return 0;
  if (to - from < prefix.length) return 0;
  return text.slice(to - prefix.length, to) === prefix ? prefix.length : 0;
}

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export function sourceEditHasContentDeletion(
  entry: string,
  current: string,
): boolean {
  if (entry === current) return false;
  return diffChars(entry, current).some(
    (part) => part.removed && part.value.trim().length > 0,
  );
}

interface DeletionOnlyRange {
  from: number;
  to: number;
}

interface SourceLine {
  text: string;
  start: number;
  end: number;
}

function splitSourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) {
      lines.push({
        text: text.slice(start),
        start,
        end: text.length,
      });
      break;
    }
    lines.push({
      text: text.slice(start, newline),
      start,
      end: newline + 1,
    });
    start = newline + 1;
  }
  return lines;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (needle[i] === haystack[j]) i++;
  }
  return i === needle.length;
}

function addMergedRange(
  ranges: DeletionOnlyRange[],
  from: number,
  to: number,
): void {
  if (to <= from) return;
  const last = ranges[ranges.length - 1];
  if (last && from <= last.to) {
    last.to = Math.max(last.to, to);
    return;
  }
  ranges.push({ from, to });
}

function findDeletedCharRanges(
  entryLine: SourceLine,
  currentLineText: string,
): DeletionOnlyRange[] | null {
  const ranges: DeletionOnlyRange[] = [];
  let currentPos = 0;
  let deletionStart = -1;

  for (let entryPos = 0; entryPos < entryLine.text.length; entryPos++) {
    if (
      currentPos < currentLineText.length &&
      entryLine.text[entryPos] === currentLineText[currentPos]
    ) {
      if (deletionStart !== -1) {
        addMergedRange(
          ranges,
          entryLine.start + deletionStart,
          entryLine.start + entryPos,
        );
        deletionStart = -1;
      }
      currentPos++;
      continue;
    }
    if (deletionStart === -1) deletionStart = entryPos;
  }

  if (currentPos !== currentLineText.length) return null;
  if (deletionStart !== -1) {
    addMergedRange(
      ranges,
      entryLine.start + deletionStart,
      entryLine.start + entryLine.text.length,
    );
  }
  return ranges;
}

function scoreLineMatch(
  currentLineText: string,
  entryLineText: string,
  distance: number,
): number {
  if (currentLineText.length === 0) {
    return entryLineText.length === 0 ? 10_000 - distance : -Infinity;
  }
  if (!isSubsequence(currentLineText, entryLineText)) return -Infinity;

  let score = currentLineText.length * 100 - distance * 2;
  if (entryLineText === currentLineText) score += 100_000;
  if (entryLineText.includes(currentLineText)) score += 50_000;
  if (entryLineText.startsWith(currentLineText)) score += 10_000;
  if (entryLineText.endsWith(currentLineText)) score += 8_000;
  score -= (entryLineText.length - currentLineText.length) * 3;
  return score;
}

function findBestLineMatch(
  entryLines: readonly SourceLine[],
  currentLine: SourceLine,
  startIndex: number,
): number {
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let i = startIndex; i < entryLines.length; i++) {
    const score = scoreLineMatch(
      currentLine.text,
      entryLines[i]!.text,
      i - startIndex,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore === -Infinity ? -1 : bestIndex;
}

function deletionOnlyRangesByLine(
  entryText: string,
  currentText: string,
): DeletionOnlyRange[] | null {
  if (currentText.length > entryText.length) return null;
  if (currentText === entryText) return [];

  const entryLines = splitSourceLines(entryText);
  const currentLines = splitSourceLines(currentText);
  const ranges: DeletionOnlyRange[] = [];
  let entryIndex = 0;

  for (const currentLine of currentLines) {
    const matchedIndex = findBestLineMatch(entryLines, currentLine, entryIndex);
    if (matchedIndex === -1) return null;

    for (let i = entryIndex; i < matchedIndex; i++) {
      const deletedLine = entryLines[i]!;
      addMergedRange(ranges, deletedLine.start, deletedLine.end);
    }

    const charRanges = findDeletedCharRanges(
      entryLines[matchedIndex]!,
      currentLine.text,
    );
    if (!charRanges) return null;
    for (const range of charRanges) addMergedRange(ranges, range.from, range.to);

    entryIndex = matchedIndex + 1;
  }

  for (let i = entryIndex; i < entryLines.length; i++) {
    const deletedLine = entryLines[i]!;
    addMergedRange(ranges, deletedLine.start, deletedLine.end);
  }

  return ranges;
}

function wrapDeletedTextForCritic(text: string): string {
  const lines = text.split("\n");
  let wrapped = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) {
      wrapped += line;
    } else {
      wrapped += `{--${line}--}`;
    }
    if (i < lines.length - 1) wrapped += "\n";
  }
  return wrapped;
}

function wrapDeletionOnlySourceEdits(
  entry: string,
  current: string,
): string | null {
  const ranges = deletionOnlyRangesByLine(entry, current);
  if (!ranges || ranges.length === 0) return null;

  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    const deleted = entry.slice(range.from, range.to);
    if (/\{\+\+|\{--|\{==|\{>>/.test(deleted)) return null;
    result += entry.slice(cursor, range.from);
    result += wrapDeletedTextForCritic(deleted);
    cursor = range.to;
  }
  result += entry.slice(cursor);
  return result;
}

function preferLaterRepeatedEqual(changes: DiffPart[]): DiffPart[] {
  const normalized: DiffPart[] = [];
  for (let i = 0; i < changes.length; i++) {
    const current = changes[i]!;
    const equal = changes[i + 1];
    const nextRemoved = changes[i + 2];
    if (
      current.removed &&
      equal &&
      !equal.added &&
      !equal.removed &&
      nextRemoved?.removed &&
      equal.value.trim().length > 0 &&
      !equal.value.includes("\n") &&
      equal.value.length <= 24 &&
      nextRemoved.value.endsWith(equal.value)
    ) {
      normalized.push({
        value:
          current.value +
          equal.value +
          nextRemoved.value.slice(0, -equal.value.length),
        removed: true,
      });
      normalized.push({ value: equal.value });
      i += 2;
      continue;
    }
    normalized.push(current);
  }
  return normalized;
}

function singleChangedRange(
  entry: string,
  current: string,
): { from: number; to: number; inserted: string; removed: string } | null {
  if (entry === current) return null;
  let prefix = 0;
  const prefixMax = Math.min(entry.length, current.length);
  while (prefix < prefixMax && entry[prefix] === current[prefix]) prefix++;

  let suffix = 0;
  const suffixMax = Math.min(entry.length - prefix, current.length - prefix);
  while (
    suffix < suffixMax &&
    entry[entry.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    from: prefix,
    to: entry.length - suffix,
    inserted: current.slice(prefix, current.length - suffix),
    removed: entry.slice(prefix, entry.length - suffix),
  };
}

function isMarkdownBlockLine(text: string): boolean {
  return /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?|(?:-{3,}|\*{3,}|_{3,})[ \t]*$|\|)/.test(
    text,
  );
}

function insertedIntroducesMarkdownBlockLine(
  inserted: string,
  removed: string,
): boolean {
  const removedLines = new Set(
    splitSourceLines(removed)
      .map((line) => line.text.trim())
      .filter((line) => line.length > 0),
  );
  return splitSourceLines(inserted).some((line) => {
    const text = line.text.trim();
    return (
      text.length > 0 &&
      isMarkdownBlockLine(text) &&
      !removedLines.has(text)
    );
  });
}

function insertedLooksCarriedOverFromRemoved(
  inserted: string,
  removed: string,
): boolean {
  const compactInserted = inserted.replace(/\s+/g, "");
  if (compactInserted.length === 0) return true;
  return isSubsequence(compactInserted, removed.replace(/\s+/g, ""));
}

export function commitSourceEdits(args: {
  currentSource: string;
  entryProjection: SourceProjection;
  existingAnnotations: readonly ReviewAnnotation[];
}): ReviewAnnotation[] {
  const { currentSource, entryProjection, existingAnnotations } = args;
  if (currentSource === entryProjection.md) {
    return existingAnnotations.map(cloneAnnotation);
  }

  const nextAnnotations = existingAnnotations.map(cloneAnnotation);
  const createdAt = Date.now();

  const applyAddedText = (sourcePos: number, text: string): void => {
    if (text.length === 0) return;
    const insertionSegment = findInsertionSegmentAtPoint(entryProjection, sourcePos);
    if (
      insertionSegment?.annotationId &&
      spliceInsertionAnnotation(
        nextAnnotations,
        insertionSegment.annotationId,
        sourcePos - insertionSegment.sourceFrom,
        sourcePos - insertionSegment.sourceFrom,
        text,
      )
    ) {
      return;
    }
    addSourceInsertion(
      nextAnnotations,
      text,
      mapSourcePosToBaseOffset(entryProjection, sourcePos),
      createdAt,
    );
  };

  const applyRemovedRange = (from: number, to: number): void => {
    if (to <= from) return;
    for (const segment of getIntersectingSegments(entryProjection, from, to)) {
      const localFrom = Math.max(from, segment.sourceFrom) - segment.sourceFrom;
      const localTo = Math.min(to, segment.sourceTo) - segment.sourceFrom;
      if (localTo <= localFrom) continue;

      if (segment.kind === "base") {
        const deletedText = entryProjection.md.slice(
          segment.sourceFrom + localFrom,
          segment.sourceFrom + localTo,
        );
        addSourceDeletion(
          nextAnnotations,
          deletedText,
          segment.baseOffset + localFrom,
          createdAt,
        );
        continue;
      }

      if (
        segment.kind === "insertion" &&
        segment.annotationId &&
        spliceInsertionAnnotation(
          nextAnnotations,
          segment.annotationId,
          localFrom,
          localTo,
          "",
        )
      ) {
        continue;
      }
    }
  };

  const singleChange = singleChangedRange(entryProjection.md, currentSource);
  const deletionOnlyRanges = deletionOnlyRangesByLine(
    entryProjection.md,
    currentSource,
  );

  if (
    singleChange &&
    singleChange.inserted.length > 0 &&
    singleChange.removed.length === 0
  ) {
    applyAddedText(singleChange.from, singleChange.inserted);
    return nextAnnotations.filter(isValidReviewAnnotation);
  }

  const shouldApplySingleReplacement =
    singleChange &&
    singleChange.inserted.length > 0 &&
    singleChange.removed.length > 0 &&
    (singleChange.inserted.includes("\n") ||
      singleChange.removed.includes("\n")) &&
    (!deletionOnlyRanges ||
      insertedIntroducesMarkdownBlockLine(
        singleChange.inserted,
        singleChange.removed,
      ) ||
      !insertedLooksCarriedOverFromRemoved(
        singleChange.inserted,
        singleChange.removed,
      ));
  if (shouldApplySingleReplacement) {
    applyRemovedRange(singleChange.from, singleChange.to);
    applyAddedText(singleChange.from, singleChange.inserted);
    return nextAnnotations.filter(isValidReviewAnnotation);
  }

  if (deletionOnlyRanges) {
    for (const range of deletionOnlyRanges) {
      applyRemovedRange(range.from, range.to);
    }
    return nextAnnotations.filter(isValidReviewAnnotation);
  }

  const changes = preferLaterRepeatedEqual(diffChars(entryProjection.md, currentSource));
  let entryPos = 0;

  for (let i = 0; i < changes.length; i++) {
    const part = changes[i]!;
    if (!part.added && !part.removed) {
      entryPos += part.value.length;
      continue;
    }

    if (part.removed) {
      let removedFrom = entryPos;
      let removedTo = entryPos + part.value.length;
      const originalRemovedTo = removedTo;
      const next = changes[i + 1];
      const inserted = next?.added ? next.value : "";
      if (inserted.length === 0) {
        const shift = shiftRepeatedLinePrefix(
          entryProjection.md,
          removedFrom,
          removedTo,
        );
        removedFrom -= shift;
        removedTo -= shift;
      }
      applyRemovedRange(removedFrom, removedTo);
      if (inserted.length > 0) {
        applyAddedText(removedFrom, inserted);
        i += 1;
      }
      entryPos = originalRemovedTo;
      continue;
    }

    if (part.added) {
      applyAddedText(entryPos, part.value);
    }
  }

  return nextAnnotations.filter(isValidReviewAnnotation);
}

/**
 * source モードの編集差分を {++...++} で囲んだ markdown を返す。
 *
 * entry（source に入った時の getMarkdown 出力）と current（現在の CM6 テキスト）を
 * prefix/suffix マッチで比較し、挿入された区間を {++...++} で囲む。
 * これにより setMarkdown 時に remark parser が criticInsertion PM marks を生成する。
 */
/**
 * source 編集の挿入と削除を一括で CriticMarkup 化する。
 * 削除 = {--deleted--}、挿入 = {++inserted++}。
 * 置換（削除+挿入）= {--old--}{++new++}。
 */
export function wrapSourceEdits(entry: string, current: string): string {
  if (current === entry) return current;

  const deletionOnly = wrapDeletionOnlySourceEdits(entry, current);
  if (deletionOnly !== null) return deletionOnly;

  let pre = 0;
  const preMax = Math.min(entry.length, current.length);
  while (pre < preMax && entry[pre] === current[pre]) pre++;

  let suf = 0;
  const sufMax = Math.min(entry.length - pre, current.length - pre);
  while (
    suf < sufMax &&
    entry[entry.length - 1 - suf] === current[current.length - 1 - suf]
  )
    suf++;

  const deleted = entry.slice(pre, entry.length - suf);
  const inserted = current.slice(pre, current.length - suf);

  if (deleted.length === 0 && inserted.length === 0) return current;

  const hasCritic = /\{\+\+|\{--|\{==|\{>>/.test(deleted + inserted);
  if (hasCritic) return current;

  let markup = "";
  if (deleted.length > 0) {
    markup += wrapDeletedTextForCritic(deleted);
  }
  if (inserted.length > 0) {
    markup += "{++" + inserted + "++}";
  }

  return current.slice(0, pre) + markup + current.slice(current.length - suf);
}

export function wrapSourceInsertions(entry: string, current: string): string {
  if (current === entry) return current;

  let pre = 0;
  const preMax = Math.min(entry.length, current.length);
  while (pre < preMax && entry[pre] === current[pre]) pre++;

  let suf = 0;
  const sufMax = Math.min(entry.length - pre, current.length - pre);
  while (
    suf < sufMax &&
    entry[entry.length - 1 - suf] === current[current.length - 1 - suf]
  )
    suf++;

  const inserted = current.slice(pre, current.length - suf);
  if (inserted.length === 0) return current;

  if (/\{\+\+|\{--|\{==|\{>>/.test(inserted)) return current;

  return (
    current.slice(0, pre) +
    "{++" +
    inserted +
    "++}" +
    current.slice(current.length - suf)
  );
}
