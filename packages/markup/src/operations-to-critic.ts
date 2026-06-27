/**
 * operations-to-critic.ts — Operations 群を CriticMarkup 文字列に書き下す
 *
 * ## 責務
 * `operationsToCritic(baseRaw, operations)` を公開する。
 * Operations（time-ordered list）を baseRaw に順次適用し、
 * CriticMarkup 記法（{--…--} / {++…++} / {==…==}{>>…<<}）入りの
 * Markdown 文字列を返す。
 *
 * ## 設計上の制約（plan18 design §3-1）
 * - 入力 from/to はすべて **baseRaw 上の正規座標**（派生座標ではない）。
 * - 冪等性：`operationsToCritic(b, ops) === operationsToCritic(b, ops)` 必須。
 * - シナリオA入れ子（`{--重要{++素晴らしい++}です--}`）を正しく生成。
 * - 段落またぎ許容（HLD v2 §5.5 方向転換）：段落境界をまたぐ CriticMarkup マークは
 *   正当な操作として生成される（削除・追記・コメントすべて段落またぎ可）。
 *
 * ## 触らない範囲（plan18 禁則）
 * - parseCritic / serializeCritic / rejectView は変更しない。
 *
 * ## 型について
 * Operation / Operations は @akapen/shared から import する（plan19 #4 HIGH-1 で shared を唯一の真実源に昇格）。
 */

import type { OperationType, OperationOrigin, Operation, Operations } from '@akapen/shared';
export type { OperationType, OperationOrigin, Operation, Operations };

// ---------------------------------------------------------------------------
// CriticMarkup タグ定数
// ---------------------------------------------------------------------------

const OPEN_DELETION  = '{--';
const CLOSE_DELETION = '--}';
const OPEN_INSERTION = '{++';
const CLOSE_INSERTION = '++}';
const OPEN_HIGHLIGHT  = '{==';

/** コメントの閉じタグを生成（`==}{>>payload<<}` 形式） */
function buildCommentClose(payload: string): string {
  return `==}{>>${payload}<<}`;
}

// ---------------------------------------------------------------------------
// 内部型：タグ挿入イベント
// ---------------------------------------------------------------------------

interface TagEvent {
  /** baseRaw 上の挿入位置 */
  pos: number;
  /** 挿入するタグ文字列 */
  tag: string;
  /**
   * 同一位置で複数タグが衝突するときの優先順（小さいほど先に出力）。
   * 開きタグ: 10-20 / 閉じタグ: 80-90 / comment-delete 消去用: 5
   */
  priority: number;
  /** comment-delete 相殺用: 除外すべき comment の from */
  _commentDeleteFrom?: number;
  /** comment-delete 相殺用: 除外すべき comment の to */
  _commentDeleteTo?: number;
}

// ---------------------------------------------------------------------------
// メイン関数
// ---------------------------------------------------------------------------

/**
 * Operations を baseRaw に適用し、CriticMarkup 入り Markdown 文字列を返す。
 *
 * ### アルゴリズム
 * 1. operations を走査し、baseRaw 上の位置にタグ挿入イベントを積む。
 * 2. comment-delete が存在する場合、同一範囲の comment-add/edit イベントを相殺。
 * 3. イベントを位置 → priority 昇順でソート。
 * 4. baseRaw を走査しながらタグを挿入して結果文字列を構築。
 *
 * ### 冪等性
 * 純粋関数（副作用なし・外部状態参照なし）。
 *
 * @param baseRaw    開いたファイルの生テキスト（不変）
 * @param operations 時系列順の操作リスト
 * @returns CriticMarkup 入り Markdown 文字列
 */
export function operationsToCritic(baseRaw: string, operations: Operations): string {
  if (operations.length === 0) return baseRaw;

  // Step 1: タグ挿入イベントを構築
  const events: TagEvent[] = [];

  for (const op of operations) {
    switch (op.type) {
      case 'delete': {
        events.push({ pos: op.from, tag: OPEN_DELETION,  priority: 10 });
        events.push({ pos: op.to,   tag: CLOSE_DELETION, priority: 90 });
        break;
      }
      case 'insert': {
        // 点挿入（from === to）: {++payload++} を 1 イベントで追加
        const payload = op.payload ?? '';
        events.push({
          pos: op.from,
          tag: `${OPEN_INSERTION}${payload}${CLOSE_INSERTION}`,
          priority: 20,
        });
        break;
      }
      case 'comment-add': {
        const payload = op.payload ?? '';
        events.push({ pos: op.from, tag: OPEN_HIGHLIGHT,              priority: 11 });
        events.push({ pos: op.to,   tag: buildCommentClose(payload),  priority: 89 });
        break;
      }
      case 'comment-edit': {
        // 同一範囲の comment-add を上書き: 新 payload で open/close を再生成。
        // 後で同位置の comment-add イベントを相殺し、edit の内容に差し替える。
        const payload = op.payload ?? '';
        events.push({ pos: op.from, tag: OPEN_HIGHLIGHT,              priority: 11 });
        events.push({ pos: op.to,   tag: buildCommentClose(payload),  priority: 89 });
        break;
      }
      case 'comment-delete': {
        // 除外マーカーを記録。Step 2 で同一範囲の comment イベントを取り除く。
        events.push({
          pos: op.from,
          tag: '',
          priority: 5,
          _commentDeleteFrom: op.from,
          _commentDeleteTo: op.to,
        });
        break;
      }
    }
  }

  // Step 2: comment-delete イベントによる相殺
  const deleteRanges = events.filter(e => e._commentDeleteFrom !== undefined);
  const filteredEvents = events.filter(e => {
    // comment-delete 自体を除去
    if (e._commentDeleteFrom !== undefined) return false;
    // 対応する comment-add/edit のタグを除去
    for (const del of deleteRanges) {
      const from = del._commentDeleteFrom!;
      const to   = del._commentDeleteTo!;
      if (
        (e.pos === from && e.tag === OPEN_HIGHLIGHT) ||
        (e.pos === to   && e.tag.startsWith('==}'))
      ) {
        return false;
      }
    }
    return true;
  });

  // Step 3: 位置 → priority 昇順でソート
  filteredEvents.sort((a, b) =>
    a.pos !== b.pos ? a.pos - b.pos : a.priority - b.priority
  );

  // Step 4: baseRaw を走査してタグを挿入
  let result = '';
  let cursor = 0;

  for (const ev of filteredEvents) {
    if (ev.pos < cursor) {
      // 重複/逆転（入れ子などで起こり得る）: baseRaw の追加はスキップしタグのみ挿入
      result += ev.tag;
      continue;
    }
    result += baseRaw.slice(cursor, ev.pos);
    result += ev.tag;
    cursor = ev.pos;
  }

  // 残りの baseRaw を追加
  result += baseRaw.slice(cursor);

  return result;
}
