export interface TextAnchor {
  baseOffset: number;
  baseLength: number;
  quote: string;
}

export interface InsertionAnnotation {
  id: string;
  type: "insertion";
  anchor: TextAnchor;
  text: string;
  source: "preview" | "source";
  createdAt: number;
}

export interface DeletionAnnotation {
  id: string;
  type: "deletion";
  anchor: TextAnchor;
  deletedText: string;
  source: "preview" | "source";
  createdAt: number;
}

export interface CommentAnnotation {
  id: string;
  type: "comment";
  anchor: TextAnchor;
  quotedText: string;
  instruction: string;
  createdAt: number;
}

export interface FormatChangeAnnotation {
  id: string;
  type: "format-change";
  description: string;
  createdAt: number;
}

export type ReviewAnnotation =
  | InsertionAnnotation
  | DeletionAnnotation
  | CommentAnnotation
  | FormatChangeAnnotation;

export interface AkaPenReviewState {
  version: 1;
  base: { rawMarkdown: string };
  working: { rawMarkdown: string };
  annotations: ReviewAnnotation[];
}
