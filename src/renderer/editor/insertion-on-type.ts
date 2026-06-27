/**
 * insertion-on-type.ts — v5: PM doc が真実源。
 *
 * - appendTransaction で人入力のテキスト範囲に `{++…++}` insertion マークを付与
 * - 削除マーク `{--…--}` 内への入力を一次網（handleTextInput）/ 二次網（appendTransaction）で抑止
 * - paste は critic 4マーク剥がし（transformPasted）
 * - compositionend（IME 確定）後に空 tr を dispatch して appendTransaction を起動
 *
 * v4 の OperationStore wiring / pending coalescing / recordInsertOp は plan30 で撤去。
 */
import type { MarkType, Node } from "@milkdown/kit/prose/model";
import { Fragment, Slice } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { Mappable } from "@milkdown/kit/prose/transform";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { AKAPEN_COMMAND_META } from "./commands";
import { criticMarkSchemas, deletionSchema, insertionSchema } from "./critic";
import { AKAPEN_GESTURE_META } from "./gesture";

/** 初期ロード中のフラグ。true の間は appendTransaction で insertion マークを付けない。 */
let loadingEditorsFlag = false;
export function setInsertionOnTypeLoading(loading: boolean): void {
  loadingEditorsFlag = loading;
}
import { AKAPEN_SKIP_INSERTION_META } from "./milkdown";

// ---------------------------------------------------------------------------
// legacy 経路の型・ユーティリティ（appendTransaction で使う）
// ---------------------------------------------------------------------------

export interface InsertedRange {
  from: number;
  to: number;
}

interface InsertionOnTypeState {
  ranges: readonly InsertedRange[];
}

const FLUSH = "flush";
const insertionOnTypeKey = new PluginKey<InsertionOnTypeState>(
  "akapenInsertionOnType",
);
const HISTORY_META_KEY = "history$";

function mapRanges(
  ranges: readonly InsertedRange[],
  mapping: Mappable,
): InsertedRange[] {
  const mapped: InsertedRange[] = [];
  for (const range of ranges) {
    const from = mapping.map(range.from, 1);
    const to = mapping.map(range.to, -1);
    if (to > from) mapped.push({ from, to });
  }
  return mapped;
}

function insertedRangesOf(tr: Transaction): InsertedRange[] {
  const ranges: InsertedRange[] = [];
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1);
    step.getMap().forEach((_fromA, _toA, fromB, toB) => {
      if (toB <= fromB) return;
      const from = rest.map(fromB, 1);
      const to = rest.map(toB, -1);
      if (to > from) ranges.push({ from, to });
    });
  });
  return ranges;
}

function mergeRanges(ranges: readonly InsertedRange[]): InsertedRange[] {
  if (ranges.length <= 1) return ranges.map((r) => ({ ...r }));
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: InsertedRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.from <= last.to) {
      if (current.to > last.to) last.to = current.to;
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/**
 * compositionend で蓄積された ranges を全件処理する純粋関数。
 * merge 後の各 range を降順（from desc）で返す。
 * vitest から直接呼んで「複数 range が落ちないこと」を assert する。
 */
export function planCompositionEndAppendRanges(
  ranges: readonly InsertedRange[],
): InsertedRange[] {
  const merged = mergeRanges(ranges);
  return [...merged]
    .filter((r) => r.to > r.from)
    .sort((a, b) => b.from - a.from);
}

function stripCriticMarks(
  fragment: Fragment,
  criticTypes: ReadonlySet<MarkType>,
): Fragment {
  const children: Node[] = [];
  fragment.forEach((child) => {
    let node = child;
    if (node.childCount > 0) {
      node = node.copy(stripCriticMarks(node.content, criticTypes));
    }
    if (node.marks.some((mark) => criticTypes.has(mark.type))) {
      node = node.mark(
        node.marks.filter((mark) => !criticTypes.has(mark.type)),
      );
    }
    children.push(node);
  });
  return Fragment.fromArray(children);
}

// ---------------------------------------------------------------------------
// プラグイン本体
// ---------------------------------------------------------------------------

export const insertionOnType = $prose((ctx) => {
  let editorView: EditorView | null = null;
  const composing = (): boolean => editorView?.composing === true;

  /** 除外判定: gesture/command/skip/history の tr は insertion マーク付与しない */
  const isExcluded = (tr: Transaction): boolean =>
    !tr.docChanged ||
    tr.getMeta(AKAPEN_COMMAND_META) === true ||
    tr.getMeta(AKAPEN_SKIP_INSERTION_META) === true ||
    tr.getMeta(AKAPEN_GESTURE_META) === true ||
    tr.getMeta(insertionOnTypeKey) === FLUSH ||
    tr.getMeta(HISTORY_META_KEY) !== undefined;

  /** 一次網：削除マーク内への入力を弾く */
  const insertsIntoDeletion = (state: EditorState, pos: number): boolean =>
    deletionSchema.type(ctx).isInSet(state.doc.resolve(pos).marks()) !==
    undefined;

  return new Plugin<InsertionOnTypeState>({
    key: insertionOnTypeKey,
    view: (view) => {
      editorView = view;
      return {
        destroy: () => {
          editorView = null;
        },
      };
    },
    state: {
      init: () => ({ ranges: [] }),
      apply: (tr, value) => {
        if (tr.getMeta(insertionOnTypeKey) === FLUSH) return { ranges: [] };
        let ranges = mapRanges(value.ranges, tr.mapping);
        if (!isExcluded(tr) && composing()) {
          ranges = ranges.concat(insertedRangesOf(tr));
        }
        return { ranges };
      },
    },
    appendTransaction: (transactions, _oldState, newState) => {
      if (composing()) return null;
      if (loadingEditorsFlag) return null;

      const collected: InsertedRange[] = [
        ...(insertionOnTypeKey.getState(newState)?.ranges ?? []),
      ];
      transactions.forEach((tr, index) => {
        if (isExcluded(tr)) return;
        let ranges = insertedRangesOf(tr);
        for (let later = index + 1; later < transactions.length; later++) {
          ranges = mapRanges(ranges, transactions[later].mapping);
        }
        collected.push(...ranges);
      });
      if (collected.length === 0) return null;

      const deletionType = deletionSchema.type(ctx);
      const insertionMark = insertionSchema.type(ctx).create();
      let tr = newState.tr;
      const deletionHits: InsertedRange[] = [];
      for (const range of mergeRanges(collected)) {
        tr = tr.addMark(range.from, range.to, insertionMark);
        newState.doc.nodesBetween(range.from, range.to, (node, pos) => {
          if (node.isText && deletionType.isInSet(node.marks)) {
            deletionHits.push({
              from: Math.max(pos, range.from),
              to: Math.min(pos + node.nodeSize, range.to),
            });
          }
        });
      }
      for (const hit of mergeRanges(deletionHits).reverse()) {
        tr = tr.delete(hit.from, hit.to);
      }
      return tr.setMeta(insertionOnTypeKey, FLUSH);
    },
    props: {
      handleTextInput: (view, from, _to, _text) => {
        if (insertsIntoDeletion(view.state, from)) return true;
        return false;
      },
      handlePaste: (view, _event, slice) => {
        const pmPos = view.state.selection.from;
        if (insertsIntoDeletion(view.state, pmPos)) return true;
        return false;
      },
      handleDOMEvents: {
        compositionend: (view) => {
          window.setTimeout(() => {
            if (view.composing) return;
            const pendingRanges =
              insertionOnTypeKey.getState(view.state)?.ranges ?? [];
            if (pendingRanges.length > 0) view.dispatch(view.state.tr);
          }, 0);
          return false;
        },
      },
      transformPasted: (slice) => {
        const criticTypes: ReadonlySet<MarkType> = new Set(
          criticMarkSchemas.map((schema) => schema.type(ctx)),
        );
        return new Slice(
          stripCriticMarks(slice.content, criticTypes),
          slice.openStart,
          slice.openEnd,
        );
      },
    },
  });
});
