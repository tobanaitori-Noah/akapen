/**
 * operations.ts — Operation 型定義 + ULID 生成・整合性検証（唯一の真実源）
 *
 * ## 責務
 * - 型定義: OperationType / OperationOrigin / Operation / Operations
 * - 関数: createOperation / validateOperationChain / IntegrityError
 *
 * plan21 T13（2026-06-18）で関数群を app/src/renderer/editor/operations.ts から
 * 機械的に移管した（実装ロジック不変）。app 側は re-export のみで互換性を維持する。
 *
 * ## 座標契約
 * - すべての from / to は **baseRaw 上の正規座標**（UTF-16 コード単位インデックス）。
 * - 「前の operation を適用した後の派生位置」ではない。
 *
 * ## shared への昇格経緯
 * - plan19 #4 HIGH-1: plan18 まで app/operations.ts と packages/markup/operations-to-critic.ts の
 *   2 箇所でミラー型を手書き同期していた。plan19 で shared パッケージを新設し、
 *   ここを型の唯一の真実源とした。
 * - plan21 T13: 関数群（createOperation / validateOperationChain / IntegrityError）も
 *   ここに移管した（呼び出し側は ./editor/operations 経由の re-export で無修正）。
 */

import { ulid } from 'ulid';

/**
 * 編集操作の種別。
 * - delete:         選択範囲を削除マーク化（`{--…--}`）
 * - insert:         キャレット位置に追記（`{++…++}`）
 * - comment-add:    選択範囲にコメント追加（`{==…==}{>>…<<}`）
 * - comment-edit:   既存コメントの本文を編集
 * - comment-delete: 既存コメントを削除（範囲は通常テキストに戻る）
 * - delete-undo:    mid-stack の delete op を取り消す（targetId で指定）
 *                   plan20 T8（C16 対応）で追加：削除 op の後にコメント等が積まれて
 *                   末尾でなくなった delete op を取り消すための「打ち消し op」。
 *                   append-only 原則を守るため、operations 配列から該当 delete を物理
 *                   削除せず、別の op を末尾に append してダウンストリーム（derive /
 *                   export）が論理的に除外する。
 *                   from / to は使用しない（targetId だけが意味を持つ）。
 */
export type OperationType =
  | 'delete'
  | 'insert'
  | 'comment-add'
  | 'comment-edit'
  | 'comment-delete'
  | 'delete-undo';

/**
 * 操作の発行元。v1 は 'human-owner' のみ。
 * v2 以降で 'claude-code' / 'other-user' を追加予定。
 */
export type OperationOrigin = 'human-owner';

/**
 * 1 つの編集操作を表すデータ構造。
 *
 * ## 座標契約（重要）
 * - `from` / `to` は **baseRaw 上の正規座標**（UTF-16 コード単位インデックス）。
 * - 前の operation 適用後の「派生座標」は使わない。
 *   ユーザー操作 → baseRaw 座標への逆変換は derive.ts が担う。
 *
 * ## insert 操作の場合
 * - from === to（点挿入）
 *
 * ## parentId
 * - 直前の operation の id を参照する（チェーン整合性検証用）。
 * - operations 配列の先頭 operation のみ undefined。
 */
export interface Operation {
  /** ULID（time-sortable + cryptographically random・実用上重複不可） */
  id: string;
  /** 操作種別 */
  type: OperationType;
  /**
   * baseRaw 上の開始位置（UTF-16 コード単位インデックス）。
   * ★ baseRaw 上の正規座標。派生座標ではない。
   */
  from: number;
  /**
   * baseRaw 上の終了位置（UTF-16 コード単位インデックス）。
   * insert 操作では from === to。
   * ★ baseRaw 上の正規座標。派生座標ではない。
   */
  to: number;
  /** insert / comment-add / comment-edit の本文 */
  payload?: string;
  /**
   * delete-undo の対象 op id（plan20 T8 / C16）。
   * 「この id を持つ delete op を論理的に取り消す」意味。
   * 他の op type では使用しない（undefined）。
   */
  targetId?: string;
  /** 操作発行元 */
  origin: OperationOrigin;
  /** Unix ミリ秒（クライアント時計） */
  timestamp: number;
  /**
   * 直前 operation の id。
   * チェーン整合性検証（validateOperationChain）で使用する。
   * 配列の先頭 operation では undefined。
   */
  parentId?: string;
}

/** Operation の時系列配列。`applyOperations` の入力。 */
export type Operations = Operation[];

// ---------------------------------------------------------------------------
// エラー型
// ---------------------------------------------------------------------------

/**
 * Operations List の整合性違反を表すエラー。
 * - ULID 重複（実用上起こらないが万一の保護用）
 * - parentId チェーン不整合
 * - schemaVersion 不一致（autosave 復元時）
 */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

// ---------------------------------------------------------------------------
// ファクトリ関数
// ---------------------------------------------------------------------------

/**
 * Operation を生成する。
 * - id は ULID で自動生成（指定なし時）
 * - timestamp は Date.now()（指定なし時）
 *
 * @param partial - id / timestamp 以外の必須フィールドを含む部分オブジェクト
 * @returns 完全な Operation
 */
export function createOperation(
  partial: Omit<Operation, 'id' | 'timestamp'> & Partial<Pick<Operation, 'id' | 'timestamp'>>
): Operation {
  return {
    id: partial.id ?? ulid(),
    timestamp: partial.timestamp ?? Date.now(),
    type: partial.type,
    from: partial.from,
    to: partial.to,
    origin: partial.origin,
    ...(partial.payload !== undefined ? { payload: partial.payload } : {}),
    ...(partial.parentId !== undefined ? { parentId: partial.parentId } : {}),
    ...(partial.targetId !== undefined ? { targetId: partial.targetId } : {}),
  };
}

// ---------------------------------------------------------------------------
// 整合性検証
// ---------------------------------------------------------------------------

/**
 * Operations 配列の parentId チェーン整合性を検証する。
 *
 * 検証内容：
 * 1. id の重複がないこと
 * 2. 先頭 operation の parentId が undefined であること
 * 3. i > 0 の各 operation の parentId が operations[i-1].id と一致すること
 *
 * @param ops - 検証対象の Operations 配列
 * @throws {IntegrityError} 整合性違反が検出された場合
 */
export function validateOperationChain(ops: Operations): void {
  if (ops.length === 0) return;

  // id 重複チェック
  const seenIds = new Set<string>();
  for (const op of ops) {
    if (seenIds.has(op.id)) {
      throw new IntegrityError(`Duplicate operation id detected: ${op.id}`);
    }
    seenIds.add(op.id);
  }

  // 先頭 operation の parentId は undefined でなければならない
  // （ops.length === 0 は冒頭で return 済みなので ops[0] は必ず存在＝
  // packages/shared/tsconfig.json の noUncheckedIndexedAccess 対策の `!` のみ）
  if (ops[0]!.parentId !== undefined) {
    throw new IntegrityError(
      `First operation must have parentId === undefined, got: ${ops[0]!.parentId}`
    );
  }

  // 各 operation の parentId が直前 operation の id と一致するか確認
  for (let i = 1; i < ops.length; i++) {
    const expected = ops[i - 1]!.id;
    const actual = ops[i]!.parentId;
    if (actual !== expected) {
      throw new IntegrityError(
        `Operation chain broken at index ${i}: ` +
          `expected parentId "${expected}", got "${actual ?? 'undefined'}"`
      );
    }
  }
}
