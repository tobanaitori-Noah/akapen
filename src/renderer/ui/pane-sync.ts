/**
 * F2: 左右ペインの連動スクロール＋視覚スペーサー（owner dogfood 第1回）。
 *
 * - 連動スクロール: 見出し（H1〜H3）のアンカー間比率ベースで左右ペインを追従させる
 *   （HLD §9.1）。右が「見出しAとBの40%地点」なら左も「A'とB'の40%地点」へ。
 *   見出しが無い場合はスクロール比率（scrollTop / scrollMax）で連動（フォールバック）。
 *   エコー防止は「次の scroll イベントを1回無視する」フラグ式。
 * - 視覚スペーサー: preview モードで、右（作業コピー）の追記・欄外注列ぶんの折返し等で
 *   高さがズレた時、左（ベース）の対応ブロックに inline `padding-top` を足して
 *   対応箇所の縦位置を揃える。末尾は左エディター容器の `padding-bottom` で全高も揃える。
 * - 【絶対制約】スペーサーは DOM/CSS の表示だけ。元データ（baseOriginal／workingMd／
 *   書き出し .akapen.md）には文字を一切書き込まない（テキストノードも挿入しない＝
 *   textContent を変えない）。左ペインは読み取り専用 Milkdown で doc が変わらないため
 *   inline style が PM の再描画に消されることもない。
 * - 対応付け: 左右のアンカーを可視テキスト署名で LCS 対応付けする。純追記ブロック
 *   （中身がすべて {++…++}／コメント注のみ＝base に対応物がない）は右側で
 *   スキップする。左側にしかない例外箇所は右に余白を入れず、次アンカーで対応を再開する。
 * - 再計算: 編集は debounce（EDIT_DEBOUNCE_MS）→ rAF。モード切替・読込み・境界ドラッグ・
 *   リサイズ・フォント読込みは即 rAF。
 */

export interface PaneSyncOptions {
  /** 左ペイン本体（scroll container＝.akapen-pane--base .akapen-pane-body） */
  basePaneBody: HTMLElement;
  /** 右ペイン本体（scroll container＝.akapen-pane--working .akapen-pane-body） */
  workingPaneBody: HTMLElement;
  /** 左ペイン preview のマウント先（[data-editor="base-preview"]・load を跨いで存続） */
  baseEditorRoot: HTMLElement;
  /** 右ペイン preview のマウント先（[data-editor="working-preview"]・同上） */
  workingEditorRoot: HTMLElement;
}

/** CM6 EditorView の行番号スクロール用 minimal API */
export interface SourceViewRef {
  lineBlockAtHeight(height: number): { from: number };
  lineBlockAt(pos: number): { top: number };
  readonly documentTop: number;
  readonly scrollDOM: HTMLElement;
  readonly state: {
    doc: {
      readonly lines: number;
      lineAt(pos: number): { number: number };
      line(n: number): { from: number; text: string };
    };
  };
}

export interface PaneSyncHandle {
  refresh(): void;
  refreshDebounced(): void;
  setPreviewVisible(visible: boolean): void;
  setSourceTexts(baseText: string, workingText: string): void;
  /** source モード用: CM6 EditorView を渡して見出し優先・行番号 fallback の同期を有効化 */
  setSourceViews(
    baseView: SourceViewRef | null,
    workingView: SourceViewRef | null,
  ): void;
  destroy(): void;
}

/** スペーサー付与済みブロックの印（値=付与 px。e2e の機械確認にも使う） */
const SPACER_ATTR = "data-akapen-spacer";
/** 末尾の高さ揃え（左エディター容器の padding-bottom）の印 */
const SPACER_BOTTOM_ATTR = "data-akapen-spacer-bottom";
/** 編集起点の再計算 debounce（タイプ中に毎打鍵レイアウトしない） */
const EDIT_DEBOUNCE_MS = 300;
const SOURCE_LINE_SYNC_INSET_PX = 2;

/** 右ブロックが「純追記」（base に対応物がない）か＝追記・コメント注を除くと本文が残らない */
const isPureInsertionBlock = (block: HTMLElement): boolean => {
  if ((block.textContent ?? "").trim() === "") return false;
  const clone = block.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll(
    "ins.critic-insertion, span.critic-comment",
  )) {
    el.remove();
  }
  return (clone.textContent ?? "").trim() === "";
};

// ---------------------------------------------------------------------------
// Heading-anchor proportional scroll (HLD §9.1)
// ---------------------------------------------------------------------------

/** 見出しアンカー: テキスト内容と scroll container 内の offsetTop */
interface HeadingAnchor {
  text: string;
  /** scroll container の上端を 0 とした絶対 offset (px) */
  offsetTop: number;
}

/**
 * Preview モード（ProseMirror DOM）から H1〜H3 の見出しを収集する。
 * offsetTop は scroll container（paneBody）基準。
 */
function collectPreviewHeadings(
  paneBody: HTMLElement,
  editorRoot: HTMLElement,
): HeadingAnchor[] {
  const pm = editorRoot.querySelector<HTMLElement>(".ProseMirror");
  if (!pm) return [];
  const headings = pm.querySelectorAll<HTMLElement>("h1, h2, h3");
  const containerTop = paneBody.getBoundingClientRect().top;
  const result: HeadingAnchor[] = [];
  for (const h of headings) {
    const text = (h.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) continue;
    const rect = h.getBoundingClientRect();
    const offsetTop = rect.top - containerTop + paneBody.scrollTop;
    result.push({ text, offsetTop });
  }
  return result;
}

/**
 * Source モード（CodeMirror 6）から ATX 見出し行を収集する。
 * CM6 は仮想レンダリングのため画面外の行は DOM に存在しない。
 * テキスト内容から見出しを検出し、行番号 × 行高さで offsetTop を推定する。
 */
function collectSourceHeadings(
  paneBody: HTMLElement,
  editorRoot: HTMLElement,
): HeadingAnchor[] {
  const cmEditor = editorRoot.querySelector<HTMLElement>(".cm-editor");
  if (!cmEditor) return [];
  const cmContent = cmEditor.querySelector<HTMLElement>(".cm-content");
  if (!cmContent) return [];

  // 行高さを実測（最初の .cm-line から取得）
  const firstLine = cmContent.querySelector<HTMLElement>(".cm-line");
  if (!firstLine) return [];
  const lineHeight = firstLine.getBoundingClientRect().height || 20;

  // cmContent の先頭位置（スクロールコンテンツ基準）
  const containerTop = paneBody.getBoundingClientRect().top;
  const contentTop =
    cmContent.getBoundingClientRect().top - containerTop + paneBody.scrollTop;

  // テキスト全文から見出しを行番号付きで検出
  const text = cmContent.textContent ?? "";
  const result: HeadingAnchor[] = [];
  let lineNo = 0;
  for (const line of text.split("\n")) {
    const m = /^(#{1,3})\s+(.+)/.exec(line);
    if (m) {
      const heading = m[2].replace(/\s+/g, " ").trim();
      if (heading.length > 0) {
        result.push({
          text: heading,
          offsetTop: contentTop + lineNo * lineHeight,
        });
      }
    }
    lineNo++;
  }
  return result;
}

/**
 * 左右の見出しリストをテキスト内容で対応付ける。
 * 順序を保ったまま一致する見出しをペアにする（LCS と同等のロジック）。
 * 返値は [leftIndex, rightIndex] のペア配列。
 */
function matchHeadings(
  left: readonly HeadingAnchor[],
  right: readonly HeadingAnchor[],
): Array<[number, number]> {
  // Build LCS table for exact text match
  const n = left.length;
  const m = right.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        left[i].text === right[j].text
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i].text === right[j].text) {
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
 * 見出しアンカー間の比率ベースでスクロールを連動させる。
 *
 * 見出しの揃えはビューポート上部（ANCHOR_VIEWPORT_FRAC = 0.1）を基準にする。
 * これにより、見出しが画面の上部 10% 位置で左右ペインが揃う。
 */
const ANCHOR_VIEWPORT_FRAC = 0.1;

function followByHeadings(
  src: HTMLElement,
  dst: HTMLElement,
  srcHeadings: readonly HeadingAnchor[],
  dstHeadings: readonly HeadingAnchor[],
  pairs: ReadonlyArray<readonly [number, number]>,
): number {
  const srcMax = Math.max(0, src.scrollHeight - src.clientHeight);
  const dstMax = Math.max(0, dst.scrollHeight - dst.clientHeight);

  if (pairs.length === 0 || srcMax === 0) {
    // 見出しペアなし: 比率スクロール。同一内容でもペイン幅差で scrollHeight が異なるため、
    // スクロール比率で位置を合わせる（1:1 だと折り返し差で行がズレる）。
    if (srcMax === 0) return 0;
    return Math.round((src.scrollTop / srcMax) * dstMax);
  }

  // 見出しの「画面内 anchor 位置」= scrollTop + clientHeight * FRAC
  const srcAnchor = src.scrollTop + src.clientHeight * ANCHOR_VIEWPORT_FRAC;
  const dstAnchorOffset = dst.clientHeight * ANCHOR_VIEWPORT_FRAC;

  const srcOffsets = pairs.map(([si]) => srcHeadings[si].offsetTop);
  const dstOffsets = pairs.map(([, di]) => dstHeadings[di].offsetTop);

  // srcAnchor が最初の見出し以前
  if (srcAnchor <= srcOffsets[0]) {
    if (srcOffsets[0] <= 0) return 0;
    const frac = srcAnchor / srcOffsets[0];
    return Math.round(Math.max(0, frac * dstOffsets[0] - dstAnchorOffset));
  }

  // 見出し間
  for (let k = 0; k < pairs.length - 1; k++) {
    if (srcAnchor >= srcOffsets[k] && srcAnchor <= srcOffsets[k + 1]) {
      const srcSegLen = srcOffsets[k + 1] - srcOffsets[k];
      if (srcSegLen <= 0)
        return Math.round(Math.max(0, dstOffsets[k] - dstAnchorOffset));
      const frac = (srcAnchor - srcOffsets[k]) / srcSegLen;
      const dstPos = dstOffsets[k] + frac * (dstOffsets[k + 1] - dstOffsets[k]);
      return Math.round(Math.max(0, dstPos - dstAnchorOffset));
    }
  }

  // 最後の見出し以降
  const lastSrc = srcOffsets[srcOffsets.length - 1];
  const lastDst = dstOffsets[dstOffsets.length - 1];
  const srcTail = src.scrollHeight - lastSrc;
  const dstTail = dst.scrollHeight - lastDst;
  if (srcTail <= 0)
    return Math.round(Math.min(Math.max(0, lastDst - dstAnchorOffset), dstMax));
  const frac = (srcAnchor - lastSrc) / srcTail;
  const dstPos = lastDst + frac * dstTail;
  return Math.round(Math.min(Math.max(0, dstPos - dstAnchorOffset), dstMax));
}

/**
 * v1.1.2: ルールベースのアンカー対応付け。
 *
 * アンカーにできるブロック（コンテナと子孫の両方をアンカーにしない）:
 *   1. .ProseMirror の直接子ブロック（ただし ul/ol/blockquote は除外し子を使う）
 *   2. <li> の直接子ブロック
 *   3. blockquote の直接子ブロック
 *
 * ul/ol/blockquote コンテナ自体はアンカーから除外し、その直接子だけを使う。
 * これにより箇条書き項目単位・引用ブロック単位で左右の縦位置が揃う。
 * 純追記ブロックはアンカーから除外する（base に対応物がない）。
 *
 * 左側（base）のアンカー一覧と右側（working）のアンカー一覧を独立して構築し、
 * 可視テキスト署名の LCS で対応付ける（細粒度化で残差は縮む）。
 */
function collectAnchors(pm: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const child of pm.children) {
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      // リストコンテナ自体はスキップ → li を直接アンカーに
      for (const li of child.children) {
        if (li instanceof HTMLElement && li.tagName.toLowerCase() === "li") {
          result.push(li);
        }
      }
    } else if (tag === "blockquote") {
      // blockquote コンテナ自体はスキップ → 直接子ブロックをアンカーに
      for (const bqChild of child.children) {
        if (bqChild instanceof HTMLElement) {
          result.push(bqChild);
        }
      }
    } else {
      result.push(child);
    }
  }
  return result;
}

interface SignedAnchor {
  el: HTMLElement;
  signature: string;
}

function visibleSignature(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const addition of clone.querySelectorAll(
    "ins.critic-insertion, span.critic-comment",
  )) {
    addition.remove();
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function collectSignedAnchors(
  pm: HTMLElement,
  options: { skipPureInsertion: boolean },
): SignedAnchor[] {
  return collectAnchors(pm)
    .filter((el) => !(options.skipPureInsertion && isPureInsertionBlock(el)))
    .map((el) => ({ el, signature: visibleSignature(el) }))
    .filter((anchor) => anchor.signature.length > 0);
}

function pairAnchorsByLcs(
  left: readonly SignedAnchor[],
  right: readonly SignedAnchor[],
): Array<[SignedAnchor, SignedAnchor]> {
  const dp: number[][] = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      dp[i][j] =
        left[i].signature === right[j].signature
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[SignedAnchor, SignedAnchor]> = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i].signature === right[j].signature) {
      pairs.push([left[i], right[j]]);
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

export function createPaneSync(options: PaneSyncOptions): PaneSyncHandle {
  const { basePaneBody, workingPaneBody, baseEditorRoot, workingEditorRoot } =
    options;

  // --- 連動スクロール（見出しアンカー比率ベース・HLD §9.1） ---
  // プログラム的な scrollTop 代入もエコーの scroll イベントを起こすため、
  // 「値が実際に変わる時だけ代入し、相手側の次イベントを1回無視する」で往復を断つ。
  let ignoreNextScrollOf: HTMLElement | null = null;

  // 見出しキャッシュ: layout() / refreshHeadingCache() で再計算。scroll イベントでは再計算しない。
  let cachedBaseHeadings: HeadingAnchor[] = [];
  let cachedWorkingHeadings: HeadingAnchor[] = [];
  let cachedHeadingPairs: Array<[number, number]> = [];
  // source モードの全文テキスト（外部注入・CM6 仮想レンダリング回避）
  let sourceBaseText = "";
  let sourceWorkingText = "";

  /** CM6 view から見出しを収集する（lineBlockAt で正確な pixel 位置） */
  function headingsFromView(
    view: SourceViewRef,
    paneBody: HTMLElement,
    editorRoot: HTMLElement,
  ): HeadingAnchor[] {
    const result: HeadingAnchor[] = [];
    void editorRoot;
    const paneTop = paneBody.getBoundingClientRect().top;
    const doc = view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const m = /^(#{1,3})\s+(.+)/.exec(line.text);
      if (m) {
        const heading = m[2].replace(/\s+/g, " ").trim();
        if (heading.length > 0) {
          try {
            const block = view.lineBlockAt(line.from);
            result.push({
              text: heading,
              offsetTop:
                view.documentTop + block.top - paneTop + paneBody.scrollTop,
            });
          } catch {
            // line out of range
          }
        }
      }
    }
    return result;
  }

  /** source テキストから見出しを収集する（全文ベース・lineHeight で位置推定） */
  function headingsFromText(
    text: string,
    paneBody: HTMLElement,
    editorRoot: HTMLElement,
  ): HeadingAnchor[] {
    const cmEditor = editorRoot.querySelector<HTMLElement>(".cm-editor");
    if (!cmEditor) return [];
    const cmContent = cmEditor.querySelector<HTMLElement>(".cm-content");
    if (!cmContent) return [];
    const firstLine = cmContent.querySelector<HTMLElement>(".cm-line");
    if (!firstLine) return [];
    const lineHeight = firstLine.getBoundingClientRect().height || 20;
    const containerTop = paneBody.getBoundingClientRect().top;
    const contentTop =
      cmContent.getBoundingClientRect().top - containerTop + paneBody.scrollTop;

    const result: HeadingAnchor[] = [];
    let lineNo = 0;
    for (const line of text.split("\n")) {
      const m = /^(#{1,3})\s+(.+)/.exec(line);
      if (m) {
        const heading = m[2].replace(/\s+/g, " ").trim();
        if (heading.length > 0) {
          result.push({
            text: heading,
            offsetTop: contentTop + lineNo * lineHeight,
          });
        }
      }
      lineNo++;
    }
    return result;
  }

  /** 見出しキャッシュを再構築する */
  function refreshHeadingCache(): void {
    if (previewVisible) {
      // preview: PM DOM の見出し要素から正確な位置を取得
      cachedBaseHeadings = collectPreviewHeadings(basePaneBody, baseEditorRoot);
      cachedWorkingHeadings = collectPreviewHeadings(
        workingPaneBody,
        workingEditorRoot,
      );
    } else if (srcBaseView && srcWorkView) {
      // source: CM6 view から見出しを収集（lineBlockAt で正確な pixel 位置）
      cachedBaseHeadings = headingsFromView(
        srcBaseView,
        basePaneBody,
        baseEditorRoot,
      );
      cachedWorkingHeadings = headingsFromView(
        srcWorkView,
        workingPaneBody,
        workingEditorRoot,
      );
    } else {
      cachedBaseHeadings = [];
      cachedWorkingHeadings = [];
    }
    cachedHeadingPairs = matchHeadings(
      cachedBaseHeadings,
      cachedWorkingHeadings,
    );
  }

  /**
   * 見出しアンカー比率で dst.scrollTop を設定する。
   * 1:1 ミラーリングの代わりに、対応する見出し間の割合で位置を決める。
   */
  const followWithHeadings = (
    src: HTMLElement,
    dst: HTMLElement,
    srcHeadings: readonly HeadingAnchor[],
    dstHeadings: readonly HeadingAnchor[],
    pairs: ReadonlyArray<readonly [number, number]>,
  ): void => {
    const dstMax = Math.max(0, dst.scrollHeight - dst.clientHeight);
    const target = Math.min(
      followByHeadings(src, dst, srcHeadings, dstHeadings, pairs),
      dstMax,
    );
    if (Math.abs(dst.scrollTop - target) < 1) return;
    ignoreNextScrollOf = dst;
    dst.scrollTop = target;
  };

  /** 旧 follow (1:1) — スペーサー適用直後の再同期専用に残す */
  const follow1to1 = (src: HTMLElement, dst: HTMLElement): void => {
    const max = Math.max(0, dst.scrollHeight - dst.clientHeight);
    const target = Math.min(src.scrollTop, max);
    if (Math.abs(dst.scrollTop - target) < 1) return;
    ignoreNextScrollOf = dst;
    dst.scrollTop = target;
  };

  // source モード行番号同期用の CM6 view 参照
  let srcBaseView: SourceViewRef | null = null;
  let srcWorkView: SourceViewRef | null = null;

  /**
   * CM6 行番号ベースのスクロール同期。
   * src の先頭表示行を取得 → dst で同じ行にスクロール。
   * 折り返し差に影響されず正確に行が揃う。
   */
  function followByLineNumber(
    srcView: SourceViewRef,
    srcPane: HTMLElement,
    srcEditorRoot: HTMLElement,
    dstView: SourceViewRef,
    dstPane: HTMLElement,
    dstEditorRoot: HTMLElement,
  ): void {
    try {
      void srcEditorRoot;
      void dstEditorRoot;
      const srcDocY = Math.max(0, srcPane.scrollTop + SOURCE_LINE_SYNC_INSET_PX);
      const srcBlock = srcView.lineBlockAtHeight(srcDocY);
      const srcLine = srcView.state.doc.lineAt(srcBlock.from);
      const dstLineFrom = dstView.state.doc.line(srcLine.number).from;
      const dstTargetY =
        dstView.lineBlockAt(dstLineFrom).top - SOURCE_LINE_SYNC_INSET_PX;
      const dstMax = Math.max(0, dstPane.scrollHeight - dstPane.clientHeight);
      const target = Math.min(
        Math.max(0, Math.round(dstTargetY)),
        dstMax,
      );
      if (Math.abs(dstPane.scrollTop - target) < 1) return;
      ignoreNextScrollOf = dstPane;
      dstPane.scrollTop = target;
    } catch {
      // line number out of range 等の安全弁
    }
  }

  const onBaseScroll = (): void => {
    if (ignoreNextScrollOf === basePaneBody) {
      ignoreNextScrollOf = null;
      return;
    }
    if (!previewVisible && srcBaseView && srcWorkView) {
      refreshHeadingCache();
      if (cachedHeadingPairs.length > 0) {
        followWithHeadings(
          basePaneBody,
          workingPaneBody,
          cachedBaseHeadings,
          cachedWorkingHeadings,
          cachedHeadingPairs,
        );
      } else {
        follow1to1(basePaneBody, workingPaneBody);
      }
      return;
    }
    followWithHeadings(
      basePaneBody,
      workingPaneBody,
      cachedBaseHeadings,
      cachedWorkingHeadings,
      cachedHeadingPairs,
    );
  };
  const onWorkingScroll = (): void => {
    if (ignoreNextScrollOf === workingPaneBody) {
      ignoreNextScrollOf = null;
      return;
    }
    if (!previewVisible && srcBaseView && srcWorkView) {
      refreshHeadingCache();
      if (cachedHeadingPairs.length > 0) {
        followWithHeadings(
          workingPaneBody,
          basePaneBody,
          cachedWorkingHeadings,
          cachedBaseHeadings,
          cachedHeadingPairs.map(([l, r]) => [r, l] as [number, number]),
        );
      } else {
        follow1to1(workingPaneBody, basePaneBody);
      }
      return;
    }
    followWithHeadings(
      workingPaneBody,
      basePaneBody,
      cachedWorkingHeadings,
      cachedBaseHeadings,
      cachedHeadingPairs.map(([l, r]) => [r, l] as [number, number]),
    );
  };
  basePaneBody.addEventListener("scroll", onBaseScroll, { passive: true });
  workingPaneBody.addEventListener("scroll", onWorkingScroll, {
    passive: true,
  });

  // --- 視覚スペーサー（preview のみ） ---
  let previewVisible = false;
  let rafId: number | null = null;
  let debounceId: number | null = null;

  const clearSpacers = (): void => {
    for (const el of baseEditorRoot.querySelectorAll<HTMLElement>(
      `[${SPACER_ATTR}]`,
    )) {
      el.style.paddingTop = "";
      el.removeAttribute(SPACER_ATTR);
    }
    baseEditorRoot.style.paddingBottom = "";
    baseEditorRoot.removeAttribute(SPACER_BOTTOM_ATTR);
  };

  function layout(): void {
    clearSpacers();
    if (!previewVisible) {
      // source モードでもスクロール連動用に見出しキャッシュは更新する
      refreshHeadingCache();
      return;
    }
    const basePm = baseEditorRoot.querySelector<HTMLElement>(".ProseMirror");
    const workPm = workingEditorRoot.querySelector<HTMLElement>(".ProseMirror");
    if (!basePm || !workPm) return;

    // li/blockquote 直接子を含むルールベースアンカーで細粒度化。
    // 左は全アンカー・右は純追記を除外し、可視テキスト署名の LCS で対応付ける。
    const pairs = pairAnchorsByLcs(
      collectSignedAnchors(basePm, { skipPureInsertion: false }),
      collectSignedAnchors(workPm, { skipPureInsertion: true }),
    );

    const leftOrigin = basePm.getBoundingClientRect().top;
    const rightOrigin = workPm.getBoundingClientRect().top;

    // 先に全対の必要量を測ってから適用（measure と mutate を分けてレイアウトスラッシュを避ける）。
    // padding-top はブロックの rect.top を動かさず中身だけ下げる＝後続ブロックは付与 px ぶん
    // 正確にずれるので、累積 acc で帳尻を取る。負（左が下に出る）は縮められないため 0 でクランプ。
    const adds: number[] = [];
    let acc = 0;
    for (let k = 0; k < pairs.length; k++) {
      const [left, right] = pairs[k];
      const leftTop = left.el.getBoundingClientRect().top - leftOrigin;
      const rightTop = right.el.getBoundingClientRect().top - rightOrigin;
      const add = Math.round(rightTop - (leftTop + acc));
      adds[k] = add > 1 ? add : 0;
      acc += adds[k];
    }
    for (let k = 0; k < pairs.length; k++) {
      if (adds[k] > 0) {
        pairs[k][0].el.style.paddingTop = `${adds[k]}px`;
        pairs[k][0].el.setAttribute(SPACER_ATTR, String(adds[k]));
      }
    }

    // 末尾の高さ揃え: 右（欄外注のはみ出し込み）と全高を合わせ、1:1 スクロールを末尾まで効かせる
    const diff = Math.ceil(
      workingPaneBody.scrollHeight - basePaneBody.scrollHeight,
    );
    if (diff > 0) {
      baseEditorRoot.style.paddingBottom = `${diff}px`;
      baseEditorRoot.setAttribute(SPACER_BOTTOM_ATTR, String(diff));
    }

    // スペーサー適用後に見出しキャッシュを再構築し、スクロール位置を再同期する。
    // スペーサーで左ペインの scrollHeight と見出し offsetTop が変わるため。
    refreshHeadingCache();
    follow1to1(workingPaneBody, basePaneBody);
  }

  const refresh = (): void => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      layout();
    });
  };

  const refreshDebounced = (): void => {
    if (debounceId !== null) window.clearTimeout(debounceId);
    debounceId = window.setTimeout(() => {
      debounceId = null;
      refresh();
    }, EDIT_DEBOUNCE_MS);
  };

  const onResize = (): void => {
    refresh();
  };
  window.addEventListener("resize", onResize);
  // Klee One（@font-face）の遅延読込みで右ペインが再フローしても位置を取り直す
  document.fonts.addEventListener("loadingdone", onResize);

  return {
    refresh,
    refreshDebounced,
    setPreviewVisible(next) {
      previewVisible = next;
      if (!next) {
        clearSpacers();
      }
      refreshHeadingCache();
      refresh();
    },
    setSourceTexts(baseText, workingText) {
      sourceBaseText = baseText;
      sourceWorkingText = workingText;
      refreshHeadingCache();
    },
    setSourceViews(baseView, workingView) {
      srcBaseView = baseView;
      srcWorkView = workingView;
    },
    destroy() {
      basePaneBody.removeEventListener("scroll", onBaseScroll);
      workingPaneBody.removeEventListener("scroll", onWorkingScroll);
      window.removeEventListener("resize", onResize);
      document.fonts.removeEventListener("loadingdone", onResize);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (debounceId !== null) window.clearTimeout(debounceId);
      clearSpacers();
    },
  };
}
