/**
 * @akapen/shared — パッケージ公開エントリーポイント
 *
 * app と packages/markup の両方から import される型定義・関数を再 export する。
 */
export type {
  OperationType,
  OperationOrigin,
  Operation,
  Operations,
} from './operations.js';

// plan21 T13（2026-06-18）: createOperation / validateOperationChain / IntegrityError を
// shared に移管。旧所在 app/src/renderer/editor/operations.ts は re-export のみ（互換性維持）。
export { createOperation, validateOperationChain, IntegrityError } from './operations.js';

// plan21 T12 C1（2026-06-18）: displayedPositionToDerived を shared に移管。
// 旧所在 app/src/renderer/editor/derive.ts は re-export のみ（互換性維持）。
export { displayedPositionToDerived } from './displayed-position.js';
