import type {
  ReviewAnnotation,
  DeletionAnnotation,
  InsertionAnnotation,
  CommentAnnotation,
} from "./types.js";

let idCounter = 0;

export function generateAnnotationId(): string {
  idCounter += 1;
  return `ann-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function annotationContentEquals(
  a: ReviewAnnotation,
  b: ReviewAnnotation,
): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "deletion":
      return a.deletedText === (b as DeletionAnnotation).deletedText;
    case "insertion":
      return a.text === (b as InsertionAnnotation).text;
    case "comment":
      return (
        a.quotedText === (b as CommentAnnotation).quotedText &&
        a.instruction === (b as CommentAnnotation).instruction
      );
    case "format-change":
      return false;
  }
}

function annotationIdentityEquals(
  a: ReviewAnnotation,
  b: ReviewAnnotation,
): boolean {
  if (a.type !== b.type) return false;
  if (
    "anchor" in a &&
    "anchor" in b &&
    (a.anchor.baseOffset !== b.anchor.baseOffset ||
      a.anchor.baseLength !== b.anchor.baseLength)
  ) {
    return false;
  }
  return annotationContentEquals(a, b);
}

export function isValidReviewAnnotation(annotation: ReviewAnnotation): boolean {
  switch (annotation.type) {
    case "deletion":
      return (
        annotation.deletedText.trim().length > 0 &&
        annotation.anchor.baseLength > 0
      );
    case "insertion":
      return annotation.text.length > 0;
    case "comment":
      return (
        annotation.quotedText.trim().length > 0 &&
        annotation.instruction.trim().length > 0 &&
        annotation.anchor.baseLength > 0
      );
    case "format-change":
      return annotation.description.trim().length > 0;
  }
}

export class AnnotationStore {
  private items: ReviewAnnotation[] = [];

  add(annotation: ReviewAnnotation): void {
    if (!isValidReviewAnnotation(annotation)) return;
    this.items.push(annotation);
  }

  remove(id: string): boolean {
    const idx = this.items.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }

  get(id: string): ReviewAnnotation | undefined {
    return this.items.find((a) => a.id === id);
  }

  getAll(): readonly ReviewAnnotation[] {
    return this.items;
  }

  getByType<K extends ReviewAnnotation["type"]>(
    type: K,
  ): Extract<ReviewAnnotation, { type: K }>[] {
    return this.items.filter(
      (a): a is Extract<ReviewAnnotation, { type: K }> => a.type === type,
    );
  }

  clear(): void {
    this.items = [];
  }

  snapshot(): ReviewAnnotation[] {
    return this.items.map(
      (a) =>
        ({
          ...a,
          anchor: "anchor" in a ? { ...a.anchor } : undefined,
        }) as ReviewAnnotation,
    );
  }

  restore(annotations: ReviewAnnotation[]): void {
    this.items = annotations
      .filter(isValidReviewAnnotation)
      .map(
        (a) =>
          ({
            ...a,
            anchor: "anchor" in a ? { ...a.anchor } : undefined,
          }) as ReviewAnnotation,
      );
  }

  /**
   * parseCritic 由来の新しい annotations を、既存の store とマージする。
   * 既存の annotation は保持し（PM doc が source round-trip で失った可能性がある）、
   * 新しいものだけ追加する。
   */
  mergeFrom(extracted: readonly ReviewAnnotation[]): void {
    for (const ext of extracted) {
      if (!isValidReviewAnnotation(ext)) continue;
      const exists = this.items.some((e) => annotationIdentityEquals(e, ext));
      if (!exists) {
        this.items.push(ext);
      }
    }
  }

  get size(): number {
    return this.items.length;
  }
}
