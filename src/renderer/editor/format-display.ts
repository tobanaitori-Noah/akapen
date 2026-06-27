/**
 * S1: ビュワー（Milkdown/PM）で整形を「効果＋赤・記号隠し」に見せる表示機構。
 *
 * 由来: `spikes/k35-spike/format-view-spike/src/format-display.ts`（180 行）。
 *
 * 採った機構 = (ii) ProseMirror decoration（doc 不変・表示層だけ）。
 * 理由は plan5 §S1 に記す。要旨:
 *   doc は workingMd 由来の `{++**++}重要{++**++}` のまま（criticInsertion マークで
 *   `**` を含む）＝reconcile/getMarkdown/A2'/A3 を一切触らない。表示時にだけ:
 *     1. 整形記号（`**`/`## `/`- `）を載せた criticInsertion 区間を Decoration.inline で
 *        画面から隠す（class=fx-symbol-hidden→display:none・doc には残る）。
 *     2. その記号が「効かせる対象」に bold/heading/bullet 相当 ＋ 追記赤(#c0392b)を
 *        Decoration.inline（クラス）で被せる。解除（{--**--}）は「外れる方向＋赤」で示す。
 *
 * DOC-INVARIANT（plan8 §1 必須・違反は STOP）:
 *   formatDisplay 自身は tr を返さない（appendTransaction 不使用）＝state.doc は変えない。
 *   キャレットを隠し `**` の中へ入れないための snap は **別 plugin** `formatDisplayAtomicRanges`
 *   で扱う。snap は selection のみを書き換える tr（addToHistory:false）＝doc は変わらない。
 *
 * 設計判断（plan8 §6 D5）:
 *   atomicRanges のスコープ＝隠し `**`/`## `/`- ` の全区間を atom 化（spike §6-2 必須）。
 *   選択が部分的に重なる場合はその区間端を hidden 区間外へ写す（before/after は
 *   選択方向で決め、可能なら手前境界、不能なら後ろ境界）。
 */
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const INSERTION = 'criticInsertion';
const DELETION = 'criticDeletion';
const MAX_FORMAT_DECORATIONS = 20000;

interface MarkRun {
  /** ラン本文（マークが連続する区間のテキスト） */
  text: string;
  /** doc 座標（開始・終了） */
  from: number;
  to: number;
  /** 'criticInsertion' | 'criticDeletion' | null（素テキスト） */
  mark: string | null;
}

/** 1 textblock 内を「マーク連続ラン」に割る。block の inline 子を pos 付きで舐める。 */
function runsOfBlock(block: PMNode, blockStart: number): MarkRun[] {
  const runs: MarkRun[] = [];
  let pos = blockStart + 1; // textblock の content は +1 から
  block.forEach((child) => {
    if (child.isText) {
      const names = child.marks.map((m) => m.type.name);
      const mark = names.includes(INSERTION)
        ? INSERTION
        : names.includes(DELETION)
          ? DELETION
          : null;
      const text = child.text ?? '';
      runs.push({ text, from: pos, to: pos + text.length, mark });
    }
    pos += child.nodeSize;
  });
  return runs;
}

/**
 * 行頭整形記号（見出し/箇条書き）を判定。
 * 返り値: { effect, prefixLen } または null。
 * prefixLen: テキスト内で prefix として使う文字数（= text.length の場合は全体一致・
 *            < text.length の場合は ProseMirror が同一 mark の隣接ノードをマージした
 *            「## **」のようなケース＝prefix 部分だけを隠し残りを body として扱う）。
 */
function blockPrefixEffect(text: string): { effect: string; prefixLen: number } | null {
  // 全体一致（通常ケース）
  const fullM = /^(#{1,6} )$/.exec(text);
  if (fullM) return { effect: 'fx-heading', prefixLen: text.length };
  if (text === '- ' || text === '* ' || text === '+ ') return { effect: 'fx-bullet', prefixLen: text.length };
  // 先頭一致（ProseMirror mark マージで prefix + 他記号が結合したケース）
  const prefM = /^(#{1,6} )/.exec(text);
  if (prefM) return { effect: 'fx-heading', prefixLen: prefM[1].length };
  if (/^(- |[*+] )/.exec(text)) return { effect: 'fx-bullet', prefixLen: 2 };
  return null;
}

function deletionMarkdownDisplayRanges(text: string): {
  hidden: Array<[number, number]>;
  headingBodies: Array<[number, number]>;
} {
  const hidden: Array<[number, number]> = [];
  const headingBodies: Array<[number, number]> = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nextNewline = text.indexOf('\n', lineStart);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    const line = text.slice(lineStart, lineEnd);
    const thematic = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.exec(line);
    if (thematic) {
      hidden.push([lineStart, lineEnd]);
    } else {
      const heading = /^[ \t]*#{1,6}[ \t]+/.exec(line);
      if (heading) {
        const bodyStart = lineStart + heading[0].length;
        hidden.push([lineStart, bodyStart]);
        if (bodyStart < lineEnd) headingBodies.push([bodyStart, lineEnd]);
      } else {
        const prefix =
          /^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)/.exec(line);
        if (prefix) {
          hidden.push([lineStart, lineStart + prefix[0].length]);
        }
      }
    }
    if (nextNewline === -1) break;
    lineStart = nextNewline + 1;
  }
  return { hidden, headingBodies };
}

export interface BuildResult {
  set: DecorationSet;
  /** atomicRanges 用に隠した区間（キャレット侵入防止）＝[from,to) の昇順配列 */
  hidden: Array<[number, number]>;
}

function hasHardBreak(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === 'hard_break' || node.type.name === 'hardbreak') {
      found = true;
      return false;
    }
    return !found;
  });
  return found;
}

export function buildFormatDecos(
  doc: PMNode,
): BuildResult {
  const docHasHardBreak = hasHardBreak(doc);

  const decos: Decoration[] = [];
  const hidden: Array<[number, number]> = [];

  const addInlineDeco = (
    from: number,
    to: number,
    attrs: { class: string },
    spec?: Parameters<typeof Decoration.inline>[3],
  ): void => {
    if (to <= from) return;
    if (decos.length >= MAX_FORMAT_DECORATIONS) {
      throw new Error('format-display decoration limit exceeded');
    }
    decos.push(Decoration.inline(from, to, attrs, spec));
  };

  const hide = (from: number, to: number): void => {
    if (to <= from) return;
    addInlineDeco(
      from,
      to,
      { class: 'fx-symbol-hidden' },
      { inclusiveStart: false, inclusiveEnd: false },
    );
    hidden.push([from, to]);
  };

  doc.descendants((node, posBlock) => {
    if (!node.isTextblock) return; // textblock だけ走査（その内側 inline は forEach で見る）
    const rawRuns = runsOfBlock(node, posBlock);
    if (rawRuns.length === 0) return false;

    // M-8（段階5 HIGH-1 修正）: ProseMirror が同一 mark の隣接ノードをマージした場合
    // （例: `{++## ++}{++**++}` → 単一テキストノード `## **`）に対応するため、
    // 先頭 run が insertion かつ blockPrefixEffect が先頭一致（prefixLen < text.length）なら
    // 先頭 run を「prefix run」と「remainder run」に分割してから以後の処理に渡す。
    // これにより pairWrap も含め全処理が正しい run 粒度で動く。
    let runs = rawRuns;
    const rawHead = rawRuns[0];
    if (rawHead && rawHead.mark === INSERTION) {
      const effCheck = blockPrefixEffect(rawHead.text);
      if (effCheck && effCheck.prefixLen < rawHead.text.length) {
        // マージ run を分割
        const prefixRun: MarkRun = { text: rawHead.text.slice(0, effCheck.prefixLen), from: rawHead.from, to: rawHead.from + effCheck.prefixLen, mark: rawHead.mark };
        const remainderRun: MarkRun = { text: rawHead.text.slice(effCheck.prefixLen), from: rawHead.from + effCheck.prefixLen, to: rawHead.to, mark: rawHead.mark };
        runs = [prefixRun, remainderRun, ...rawRuns.slice(1)];
      }
    }

    if (!docHasHardBreak) {
      // --- 行頭ブロック整形（見出し/箇条書き）: 先頭ランが insertion かつ記号パターン ---
      const head = runs[0];
      if (head && head.mark === INSERTION) {
        const eff = blockPrefixEffect(head.text);
        if (eff) {
          hide(head.from, head.to);
          const lastRun = runs[runs.length - 1];
          if (!lastRun) return; // head が有っても body が無いケース（head のみは装飾不要）
          // M-7（段階5）: body range を「** ラン（fx-symbol-hidden に隠れる insertion の `**`）を
          // 除いた区間」に絞る。旧実装は bodyFrom=head.to～bodyTo=lastRun.to の一括 range を
          // decoration していたため、pairWrap で隠す `**` ランを二重 decoration していた。
          // display:none が優先なので実用上問題なかったが、CSS 精緻化として本文区間のみに絞る。
          // 方針: 行頭記号直後から段落末まで走査し、insertion の `**`（= hide 対象）ランを
          // スキップして残りの区間を効果 decoration する（隙間を個別 range で被せる）。
          const bodyRuns = runs.slice(1); // head の次から（行頭記号ランを除く）
          const symRunSet = new Set<MarkRun>(); // `**` insertion ラン（pairWrap と同条件）
          const symRuns = bodyRuns.filter((r) => r.mark === INSERTION && r.text === '**');
          for (let i = 0; i + 1 < symRuns.length; i += 2) {
            symRunSet.add(symRuns[i]!);
            symRunSet.add(symRuns[i + 1]!);
          }
          for (const run of bodyRuns) {
            if (symRunSet.has(run)) continue; // ** 記号ランは body 効果から除外
            if (run.to > run.from) {
              addInlineDeco(run.from, run.to, { class: `${eff.effect} fx-red` });
            }
          }
        }
      }
    }

    // --- 削除済みの Markdown 構造記号: 本文だけを赤取り消し線で見せる ---
    for (const run of runs) {
      if (run.mark !== DELETION) continue;
      const display = deletionMarkdownDisplayRanges(run.text);
      for (const [fromOffset, toOffset] of display.hidden) {
        hide(run.from + fromOffset, run.from + toOffset);
      }
      for (const [fromOffset, toOffset] of display.headingBodies) {
        addInlineDeco(run.from + fromOffset, run.from + toOffset, {
          class: 'fx-heading fx-red',
        });
      }
    }

    if (!docHasHardBreak) {
      // --- インライン太字: insertion ラン `**` のペアで挟まれた区間 ---
      // ラン列を走査し、`**`(insertion) … `**`(insertion) を1ペアとして畳む（ネスト無し=A1）。
      pairWrap(runs, '**', INSERTION, (innerRuns, sFrom, sTo, eFrom, eTo) => {
        hide(sFrom, sTo);
        hide(eFrom, eTo);
        for (const run of innerRuns) {
          addInlineDeco(run.from, run.to, { class: 'fx-bold fx-red' });
        }
      });

      // --- 解除（既存 ** の太字外し）: deletion ラン `**` のペア ---
      pairWrap(runs, '**', DELETION, (innerRuns, sFrom, sTo, eFrom, eTo) => {
        hide(sFrom, sTo);
        hide(eFrom, eTo);
        for (const run of innerRuns) {
          // 「太字が外れる様子＋赤」: bold を付けず、控えめな赤下線で『外した』を示す。
          addInlineDeco(run.from, run.to, { class: 'fx-unbold fx-red' });
        }
      });
    }
    return false;
  });

  // hidden を from 昇順に並べる（atomicRanges スキャンが二分探索/単純走査で済むように）。
  hidden.sort((a, b) => a[0] - b[0]);

  return { set: DecorationSet.create(doc, decos), hidden };
}

/**
 * ラン列から `sym`(指定マーク) のペアを拾い、間の本文に cb を呼ぶ。
 * ペアは「同一段落内で出現順に2個ずつ」。ネスト無し（A1）前提＝単純ペアリング。
 */
function pairWrap(
  runs: MarkRun[],
  sym: string,
  markName: string,
  cb: (
    innerRuns: MarkRun[],
    sFrom: number,
    sTo: number,
    eFrom: number,
    eTo: number,
  ) => void,
): void {
  const symIndexes = runs
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.mark === markName && run.text === sym);
  for (let i = 0; i + 1 < symIndexes.length; i += 2) {
    const open = symIndexes[i]!;
    const close = symIndexes[i + 1]!;
    const innerRuns = runs
      .slice(open.index + 1, close.index)
      .filter((run) => run.to > run.from);
    cb(innerRuns, open.run.from, open.run.to, close.run.from, close.run.to);
  }
}

export const formatDisplayKey = new PluginKey<BuildResult>('akapen-format-display');

/** S1 表示プラグイン本体（ProseMirror Plugin）。doc を変えず decoration だけ供給する。 */
export function formatDisplayPlugin(): Plugin {
  return new Plugin<BuildResult>({
    key: formatDisplayKey,
    state: {
      // M-1（段階5）: init() の buildFormatDecos が例外を投げると editor 作成自体が失敗する。
      // try-catch で囲み、例外時は空の BuildResult を返す（装飾なし＝見た目が崩れるが doc は壊れない）。
      init: (_config, state) => {
        try {
          return buildFormatDecos(state.doc);
        } catch (e) {
          console.warn('[akapen] buildFormatDecos (init) threw:', e);
          return { set: DecorationSet.empty, hidden: [] };
        }
      },
      // INFO silent-fh（段階5）: buildFormatDecos が例外を投げると plugin state 更新が中断し、
      // 以後の decorations() 呼び出しが古い state を返し続ける沈黙故障パスを遮断する。
      // 例外時は DecorationSet.empty を返すことで装飾なし（見た目が崩れるが doc は壊れない）に
      // フォールバックし、console.warn でデバッグ情報を残す。
      apply: (tr, value) => {
        if (!tr.docChanged) return value;
        try {
          return buildFormatDecos(tr.doc);
        } catch (e) {
          console.warn('[akapen] buildFormatDecos threw:', e);
          return { set: DecorationSet.empty, hidden: [] };
        }
      },
    },
    props: {
      decorations(state) {
        return formatDisplayKey.getState(state)?.set ?? null;
      },
    },
  });
}

/** Milkdown 組み込み用（$prose ラッパ）。decoration 専用＝tr を返さない（DOC-INVARIANT 厳守）。 */
export const formatDisplay = $prose(() => formatDisplayPlugin());

// ============================================================
// AtomicRanges: 隠し区間にキャレットを入れない（plan8 §2-2・§6 D5）
// ============================================================

/** 位置 pos が hidden 区間の中（境界含まず・境界はOK）に居るか */
function inHidden(pos: number, hidden: Array<[number, number]>): [number, number] | null {
  for (const r of hidden) {
    if (pos > r[0] && pos < r[1]) return r;
  }
  return null;
}

/**
 * pos を hidden 区間の外側へスナップする。assoc は移動方向のヒント:
 *   assoc > 0 → 右側境界（to）へ、assoc < 0 → 左側境界（from）へ。
 * 既定（assoc === 0）は近い側の境界へ寄せる。
 */
function snapOutOfHidden(
  pos: number,
  hidden: Array<[number, number]>,
  assoc: number,
): number {
  const r = inHidden(pos, hidden);
  if (!r) return pos;
  if (assoc > 0) return r[1];
  if (assoc < 0) return r[0];
  return pos - r[0] <= r[1] - pos ? r[0] : r[1];
}

/**
 * format-display の hidden 区間にキャレットが入る選択を、外側にスナップして書き戻す
 * 別プラグイン。doc は触らず、selection のみを更新する tr を返す（addToHistory:false）。
 * format-display の plugin state（hidden 配列）を読む＝両者の hidden 定義は1点で共有。
 *
 * これで `view.setSelection(隠し ** の真ん中)` がディスパッチされても、続く
 * appendTransaction で「最近接の境界」へスナップされる＝spike §6-2 必須条件を満たす。
 */
export function atomicRangesPlugin(): Plugin {
  const SKIP_META = 'AKAPEN_ATOMIC_SKIP';
  return new Plugin({
    appendTransaction(_trs, _oldState, newState) {
      // 自分が生成した tr の再発火を防ぐ（無限ループ防御）
      if (_trs.some((tr) => tr.getMeta(SKIP_META))) return null;
      const data = formatDisplayKey.getState(newState);
      if (!data || data.hidden.length === 0) return null;
      const sel = newState.selection;
      const fromSnap = snapOutOfHidden(sel.from, data.hidden, -1);
      const toSnap = snapOutOfHidden(sel.to, data.hidden, 1);
      if (fromSnap === sel.from && toSnap === sel.to) return null;
      // 逆転検出（隠し区間の異常配置・本来は起きないはず）
      if (fromSnap > toSnap) {
        console.warn('[atomicRanges] fromSnap > toSnap: skipping', fromSnap, toSnap);
        return null;
      }
      const $from = newState.doc.resolve(fromSnap);
      const $to = newState.doc.resolve(toSnap);
      return newState.tr
        .setSelection(new TextSelection($from, $to))
        .setMeta('addToHistory', false)
        .setMeta(SKIP_META, true);
    },
  });
}

/** atomicRanges を Milkdown へ載せる用ラッパ（format-display の sibling として .use() する） */
export const formatDisplayAtomicRanges = $prose(() => atomicRangesPlugin());
