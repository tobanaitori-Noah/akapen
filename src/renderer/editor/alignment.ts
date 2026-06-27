/**
 * K3.5 段階4（plan9 §0/§4 D2・K3-9k）撤去/縮小/維持判断 = **維持**。
 *   - 撤去案: D19 が `.cm-alignment-phantom` count > 0 を要求するため、撤去すると D19 が
 *     不可逆に FAIL する＝plan9 §5 STOP 条件1（D シリーズ落ちて回復不能なら維持）に該当。
 *     ｜事前判定（D19 ロジック確認）で明らかゆえ実機検証は不要・撤去案は試行せず却下した。
 *   - 縮小案: 生テキスト基準（案B）で「左右とも生テキスト基準＝未編集なら行が機械的に一致し、
 *     編集分だけズレる」（plan3 §2-6 K11 隣接要件）。本ファイルの compute は既に stripCritic で
 *     critic デリミタだけ除去して生テキストベース比較に倒している＝**実質的に既に縮小されている**。
 *     これ以上の縮小は LCS 計算の縮退でしかなく品質を下げる＝却下。
 *   - 維持で確定。本ファイルは段階4 で不触＝D17/D19/K3-9k の機械固定に追従。
 *
 * G5: 左右 CM6 ペインの行整列エクステンション。
 *
 * 仕組み:
 * - 右ペイン（working source）の表示テキスト（CriticMarkup 区切りだけ除去）と、
 *   左ペイン（base source）を可視行署名で LCS 対応付けする。
 * - 右ペインにしか存在しない行の位置だけ、左ペインへ Decoration.widget({block:true})
 *   のファントム空行を挿入し、視覚的に行を揃える。
 * - 左ペインにしか存在しない行は右へ余白を入れない。右ペイン常時タイトを優先し、
 *   次の一致アンカーで対応を再開する。
 * - ウィジェット行には行番号が付かない・doc テキストは一切変えない（表示専用）。
 *
 * 再計算トリガー: setAlignment(baseText, workingText) 呼び出し時（debounce・rAF 後）。
 * 接続先の app.ts は source docChanged / モード切替 / divider drag / resize で呼ぶ。
 *
 * 使用 API の確認記録: docs/implementation-notes.md（v1.2 G5）。
 */

import type { Extension, Range, StateEffectType, Text } from '@codemirror/state';
import { StateEffect, StateField, Transaction } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

// ---------- phantom blank line widget ----------

class PhantomLineWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'cm-alignment-phantom';
    // textContent は空にしておく（.cm-content の textContent に混入させないため）。
    // 高さは CSS の min-height / line-height で確保する。
    return div;
  }
  override ignoreEvent(): boolean {
    return true;
  }
  // 同種ウィジェットの等価性チェック（count が同じなら再利用）
  override eq(other: PhantomLineWidget): boolean {
    return other instanceof PhantomLineWidget;
  }
}

const PHANTOM_WIDGET = Decoration.widget({ widget: new PhantomLineWidget(), block: true });

// ---------- StateEffect / StateField ----------

/** ファントム行を挿入する pos[] を渡す Effect */
const setPhantomLines: StateEffectType<number[]> = StateEffect.define<number[]>();

const phantomLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // ドキュメント変更でオフセットをマップ（外部の setAlignment が確定値を都度上書き）
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setPhantomLines)) {
        const ranges: Range<Decoration>[] = [];
        for (const pos of effect.value) {
          ranges.push(PHANTOM_WIDGET.range(pos));
        }
        // sorted: pos が昇順であることを前提（後述の sort で保証）
        decorations = Decoration.set(ranges, true);
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ---------- CriticMarkup strip ----------

const CRITIC_DELIMITER_RE = /\{--|--\}|\{\+\+|\+\+\}|\{==|==\}|\{>>|<<\}/g;
const LCS_ALIGNMENT_LINE_CAP = 500;

/** CriticMarkup の区切りだけ除去する。削除/追記/コメント本文は可視テキストとして保持する。 */
function stripCritic(text: string): string {
  return text.replace(CRITIC_DELIMITER_RE, '');
}

// ---------- diff → pos 計算 ----------

interface LineInfo {
  text: string;
  offset: number;
}

function linesWithOffsets(text: string): LineInfo[] {
  const lines = text.split('\n');
  const result: LineInfo[] = [];
  let offset = 0;
  for (const line of lines) {
    result.push({ text: line, offset });
    offset += line.length + 1;
  }
  return result;
}

function lcsPairs(left: readonly string[], right: readonly string[]): Array<[number, number]> {
  const dp: number[][] = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * LCS 対応から、baseText でファントム行を挿入すべき位置（char offset）を返す。
 * workingText 側は常に空配列を返す（右ペインに表示目的の余白を入れない）。
 *
 * ルール:
 * - 一致アンカー間で working 側の行数が base 側より多い → base の次アンカー位置へ差分ぶん挿入
 * - base 側の行数が多い例外 → 右側へは挿入せず、次アンカーの対応だけ維持
 */
function computePhantomPositions(
  baseText: string,
  workingText: string,
): { basePos: number[]; workingPos: number[] } {
  const strippedWorking = stripCritic(workingText);
  const baseLines = linesWithOffsets(baseText);
  const workingLines = linesWithOffsets(strippedWorking);
  if (baseLines.length > LCS_ALIGNMENT_LINE_CAP || workingLines.length > LCS_ALIGNMENT_LINE_CAP) {
    return { basePos: [], workingPos: [] };
  }
  const pairs = lcsPairs(
    baseLines.map((line) => line.text),
    workingLines.map((line) => line.text),
  );

  const basePos: number[] = [];
  const addGap = (baseFrom: number, workFrom: number, baseTo: number, workTo: number): void => {
    const baseGap = Math.max(0, baseTo - baseFrom);
    const workingGap = Math.max(0, workTo - workFrom);
    const missingOnBase = workingGap - baseGap;
    if (missingOnBase <= 0) return;
    const pos = baseLines[baseTo]?.offset ?? baseText.length;
    for (let i = 0; i < missingOnBase; i++) {
      basePos.push(pos);
    }
  };

  let baseCursor = 0;
  let workingCursor = 0;
  for (const [baseIndex, workingIndex] of pairs) {
    addGap(baseCursor, workingCursor, baseIndex, workingIndex);
    baseCursor = baseIndex + 1;
    workingCursor = workingIndex + 1;
  }
  addGap(baseCursor, workingCursor, baseLines.length, workingLines.length);

  return { basePos, workingPos: [] };
}

// ---------- public API ----------

export interface AlignmentHandle {
  /** base と working のテキストから整列デコレーションを再計算して両エディターに適用 */
  update(baseText: string, workingText: string): void;
  /** デコレーションをすべて除去 */
  clear(): void;
}

/**
 * 行整列エクステンション。
 * baseView と workingView の両方で createAlignmentExtension() を呼び、
 * 返した AlignmentHandle を共有してください。
 */
export function createAlignmentExtension(): {
  baseExtension: Extension;
  workingExtension: Extension;
  connect(baseView: EditorView, workingView: EditorView): AlignmentHandle;
} {
  // 各ペイン用に独立した StateField を返す（view が解決される前に extension を返す必要があるため）
  const baseField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decs, tr) {
      decs = decs.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(setPhantomLines)) {
          const ranges = e.value.map((pos) => PHANTOM_WIDGET.range(pos));
          decs = Decoration.set(ranges, true);
        }
      }
      return decs;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const workingField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decs, tr) {
      decs = decs.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(setPhantomLines)) {
          const ranges = e.value.map((pos) => PHANTOM_WIDGET.range(pos));
          decs = Decoration.set(ranges, true);
        }
      }
      return decs;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return {
    baseExtension: [baseField],
    workingExtension: [workingField],
    connect(baseView, workingView): AlignmentHandle {
      let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

      const apply = (baseText: string, workingText: string) => {
        const { basePos, workingPos } = computePhantomPositions(baseText, workingText);
        // clamp: pos はドキュメント範囲内に収める
        const clamp = (pos: number, doc: Text) =>
          Math.min(Math.max(0, pos), doc.length);
        baseView.dispatch({
          effects: setPhantomLines.of(basePos.map((p) => clamp(p, baseView.state.doc)).sort((a, b) => a - b)),
          annotations: Transaction.addToHistory.of(false),
        });
        workingView.dispatch({
          effects: setPhantomLines.of(workingPos.map((p) => clamp(p, workingView.state.doc)).sort((a, b) => a - b)),
          annotations: Transaction.addToHistory.of(false),
        });
      };

      return {
        update(baseText, workingText) {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            rafId = null;
            apply(baseText, workingText);
          });
        },
        clear() {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = null;
          baseView.dispatch({
            effects: setPhantomLines.of([]),
            annotations: Transaction.addToHistory.of(false),
          });
          workingView.dispatch({
            effects: setPhantomLines.of([]),
            annotations: Transaction.addToHistory.of(false),
          });
        },
      };
    },
  };
}

// ファントム行の「行番号なし」化: lineNumbers の lineNumberMarkers で除外する仕組みは
// CM6 の gutter API で提供されているが複雑になるため、今実装では lineNumbers は有効のまま。
// ファントム行はウィジェット（block:true）なので CM6 はウィジェット前後の行番号をそのまま
// 維持する（ウィジェット自体に行番号はつかない）。仕様適合 ✓

// また、本ファイルで export したエクステンションは codemirror.ts に組み込む。
export { LCS_ALIGNMENT_LINE_CAP, setPhantomLines, phantomLineField };
