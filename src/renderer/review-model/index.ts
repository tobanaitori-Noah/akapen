export type {
  TextAnchor,
  InsertionAnnotation,
  DeletionAnnotation,
  CommentAnnotation,
  FormatChangeAnnotation,
  ReviewAnnotation,
  AkaPenReviewState,
} from "./types.js";

export {
  AnnotationStore,
  generateAnnotationId,
  annotationContentEquals,
} from "./annotation-store.js";
export {
  extractAnnotationsFromNodes,
  reanchorToBase,
} from "./extract-annotations.js";
export {
  buildCriticMarkup,
  buildCriticProjection,
  sanitizeEmptyCriticMarkup,
  sanitizeNestedCriticMarkup,
  toPmSafeCriticMarkdown,
} from "./export-critic.js";
