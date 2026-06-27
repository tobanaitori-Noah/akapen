/**
 * 画面組み立て（空状態⇄編集状態）＝計画2 Task 5＋Task 7（renderer 側配線）。
 *
 * plan18 T15.5b で workingMd ベースから Operations List ベースに刷新（design.md §2-2 / FD §3-0）：
 * - 真実源は **`baseRaw + operations`**（state.workingMd は廃止）。
 *   `state.derivedMd = applyOperations(baseRaw, operations)` がビュワー / コードの共通入力。
 * - 左ペイン＝ベース（読み取り専用・baseOriginal）。右ペイン＝作業コピー。
 * - 表示切替は1トグルで左右同時に preview⇄source（左右独立切替は作らない）。
 *   モード切替は source-edit-bridge.ts の 4 関数（extractSourceEditDiff /
 *   diffToOperations / appendOperationsAndRefresh / syncEditorsForViewMode）に集約。
 * - 「完了」＝Task 8 配線: 現モードの差分を operation 化→即時 autosave→
 *   buildReviewContent（assembleReviewFile に operations を渡し operationsToCritic
 *   経由で書き出し）→ガード①（accept 後本文が空なら confirm）→writeReview→
 *   saved で完了パネル＋autosave 削除。
 * - Task 7 配線: D&D／onOpenFile 購読／自動保存（schemaVersion 2 = AutosaveEntryV2・
 *   1秒 debounce）／再開導線（base スナップショット基準・base 不一致は3択）／
 *   空状態の「続きから再開」リスト／onBaseChanged → state.baseChangedExternally。
 * - Task 8 配線: ガード②（開封時の衝突記法＝黄バナー）／ガード③（外部変更＝赤バナー）。
 *
 * 旧 fold / reconcile / repair / blockSafeCritic 経路は plan18 で全廃。
 * 旧ファイル（foldin.ts / fold-bracket.ts / block-safe.ts / repair.ts）は Phase 5 で物理削除。
 */
import {
  acceptView,
  findCriticTokens,
  parseCritic,
  rejectView,
} from "@akapen/markup";
import type { Extension } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { EditorView as CmEditorView, keymap } from "@codemirror/view";
import { editorViewCtx } from "@milkdown/kit/core";
import type { AkapenBridge, AutosaveEntry, BaseStat } from "./bridge";
import type { SourceEditorHandle } from "./editor/codemirror";
import { createSourceEditor } from "./editor/codemirror";
import { applySourceDeletion } from "./editor/source-redpen";
import type { TrimResult } from "./editor/source-redpen";
import {
  applyBulletList,
  applyComment,
  applyCommentAtRange,
  applyDeletion,
  applyHeading,
  editComment,
  removeCriticMarks,
  removeDeletionMark,
  removeCommentMark,
  selectionHasCommentMark,
  selectionHasDeletionMark,
  toggleBold,
} from "./editor/commands";
import type { CommandContext } from "./editor/commands";
import type { WysiwygEditorHandle } from "./editor/milkdown";
import { createWysiwygEditor } from "./editor/milkdown";
import { hasCriticDelimiter } from "./editor/gesture";
import { setInsertionOnTypeLoading } from "./editor/insertion-on-type";
import { buildReviewContent, localReviewDate } from "./export";
import { refreshDerived } from "./state";
import type { AppState, ViewMode } from "./state";
import { createBanners } from "./ui/banners";
import { createCommentPopup } from "./ui/comment-popup";
import {
  SOURCE_COMMENT_HIGHLIGHT_CLASS,
  SOURCE_COMMENT_INSTRUCTION_ATTR,
} from "./editor/source-comment-decoration";
import { createMarginNotes } from "./ui/margin-notes";
import { createPaneSync } from "./ui/pane-sync";
import { createCompletionPanel } from "./ui/panels";
import { createSelectionPopover } from "./ui/popover";
import {
  createShortcutSettingsPanel,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
} from "./ui/shortcuts-panel";
import { createToolbar } from "./ui/toolbar";
import { createTocPanel } from "./ui/toc-panel";
import { createAlignmentExtension } from "./editor/alignment";
import {
  bindingToCodeMirrorKey,
  commandIdForBinding,
  createShortcutBindings,
  DEFAULT_SHORTCUT_BINDINGS,
  isKnownDefaultBinding,
  normalizeShortcutEvent,
  shortcutSettingsFromBindings,
  SHORTCUT_COMMANDS,
} from "./shortcuts";
import type { ShortcutBindings, ShortcutCommandId } from "./shortcuts";
import "./ui/styles.css";
import { canonicalizeBrLines } from "./editor/md-canonicalize";
import {
  commitSourceEdits,
  mapSourcePosToBaseOffset,
  sourceEditHasContentDeletion,
  type SourceProjection,
} from "./editor/source-merge";
import {
  AnnotationStore,
  extractAnnotationsFromNodes,
  reanchorToBase,
  buildCriticMarkup,
  buildCriticProjection,
  sanitizeEmptyCriticMarkup,
  toPmSafeCriticMarkdown,
  generateAnnotationId,
} from "./review-model/index";
import type {
  CommentAnnotation,
  DeletionAnnotation,
  ReviewAnnotation,
} from "./review-model/index";

export interface OpenFilePayload {
  path: string;
  content: string;
  stat: BaseStat;
}

export interface AppHandle {
  /** 読込みフロー（「開く」/D&D/onOpenFile の合流点。autosave 復元判定込み） */
  openFile(payload: OpenFilePayload): Promise<void>;
  /** 表示切替（1トグルで左右同時に preview⇄source） */
  toggleViewMode(): void;
  /** 完了フロー（デフォルト保存＝書き出し＝ガード①・IntegrityError/I-O 失敗の showError 込み） */
  completeReview(): Promise<void>;
  /** G6: 名前をつけて保存フロー */
  saveReviewAs(): Promise<void>;
  getState(): Readonly<AppState>;
  /** 右ペイン WYSIWYG の実体（検証ハーネス用アクセサ） */
  getWorkingWysiwyg(): WysiwygEditorHandle | null;
  /** 右ペイン原文（CM6）の実体（検証ハーネス用アクセサ） */
  getWorkingSource(): SourceEditorHandle | null;
  /** 左ペイン原文（CM6）の実体（検証ハーネス用アクセサ） */
  getBaseSource(): SourceEditorHandle | null;
  /** e2e harness 専用: AnnotationStore の現在内容を返す。 */
  getAnnotationsForTest(): ReviewAnnotation[];
  /**
   * S6-9 e2e 検証用: loadingEditors フラグを強制設定する（harness からの制御専用）。
   * 通常は openFile が自動で true→false に切り替えるため、app コード内では使わない。
   */
  setLoadingEditors(v: boolean): void;
  /**
   * T22 e2e harness 専用: commands.ts の CommandContext を組み立てて返す。
   * harness から applyDeletion / applyComment / editComment / removeCommentMark 等を
   * 直接呼ぶ際に、app 内部の operationStore / baseRaw / operations を一貫して使うため。
   * onCommentDeleteBlocked は省略（harness では statusbar 更新不要）。
   */
  getCommandContext(editor: WysiwygEditorHandle["editor"]): CommandContext;
  /** e2e harness 専用: repair notice バナーを直接表示する。 */
  showRepairNoticeForTest(message: string, actions: readonly string[]): void;
  destroy(): Promise<void>;
}

const baseNameOf = (p: string): string => p.split("/").pop() ?? p;

export function mountApp(root: HTMLElement, bridge: AkapenBridge): AppHandle {
  // plan19 Phase 4.5: insertion-on-type の handlePaste から bridge.showError を呼ぶための
  //   グローバル経路を仕込む（plugin に bridge を渡せないため）。
  //   詳細は insertion-on-type.ts handlePaste の multi-paragraph paste ガード参照。
  type GlobalWithShowError = typeof globalThis & {
    __akapenShowError?: (args: { message: string; detail?: string }) => void;
  };
  (globalThis as GlobalWithShowError).__akapenShowError = (args) => {
    void bridge.showError(args);
  };
  const state: AppState = {
    basePath: null,
    baseOriginal: "",
    baseStat: null,
    baseRaw: "",
    operations: [],
    derivedMd: "",
    globalNote: "",
    viewMode: "preview",
    criticHits: [],
    baseChangedExternally: false,
  };

  let baseWysiwyg: WysiwygEditorHandle | null = null;
  let workingWysiwyg: WysiwygEditorHandle | null = null;
  let baseSource: SourceEditorHandle | null = null;
  let workingSource: SourceEditorHandle | null = null;
  let shortcutBindings: ShortcutBindings = { ...DEFAULT_SHORTCUT_BINDINGS };
  // Phase 7.5: 読込みフロー中の subscribe 二重発火を抑止するフラグ（後段の自動保存と共有）。
  // 旧位置は autosave セクション内（変数宣言だけ前出し・初期化は後段で行わず let 宣言だけ）。
  let loadingEditors = false; // 読込みフロー中の編集コールバックを autosave に流さない
  // Phase 1 migration: source モード進入時の PM doc を保持し、source→preview 切替時に
  // applyInsertionMarks の基準として使う。mountEditors でキャプチャし、openFile ごとにリセット。
  let basePmDoc: import("prosemirror-model").Node | null = null;

  // Phase 2: AnnotationStore — PM marks と並行して annotation を追跡。
  // source round-trip で PM doc が失う annotation を保持し、export の安定性を担保する。
  const annotationStore = new AnnotationStore();
  let sourceRoundTripInProgress = false;
  let preserveAnnotationsOnNextPmSync = false;
  let previewMarkdownFormattingDirty = false;

  function updateDerivedMdFromAnnotations(fallbackMd: string): void {
    const canonicalFallback = canonicalizeBrLines(fallbackMd);
    const strongMarkerCount = (md: string): number =>
      md.match(/\*\*/g)?.length ?? 0;
    if (
      annotationStore.size === 0 &&
      state.criticHits.length === 0 &&
      !previewMarkdownFormattingDirty &&
      state.derivedMd === state.baseOriginal &&
      strongMarkerCount(canonicalFallback) ===
        strongMarkerCount(state.baseOriginal) &&
      canonicalFallback !== state.baseOriginal
    ) {
      state.derivedMd = state.baseOriginal;
      return;
    }

    const annotationMd = buildCriticMarkup(
      state.baseOriginal,
      annotationStore.getAll(),
    );
    const rejectMatchesBase = (md: string): boolean => {
      try {
        return (
          comparableSourceProjection(rejectView(parseCritic(md))) ===
          comparableSourceProjection(state.baseOriginal)
        );
      } catch {
        return false;
      }
    };
    const hasStructuralMarkdownEdit =
      previewMarkdownFormattingDirty &&
      comparableSourceProjection(canonicalFallback) !==
        comparableSourceProjection(annotationMd);
    const fallbackIsBase =
      comparableSourceProjection(canonicalFallback) ===
      comparableSourceProjection(state.baseOriginal);
    const hasSourceMultilineInsertion = annotationStore
      .getAll()
      .some(isSourceMultilineInsertion);
    const shouldUseAnnotationProjection =
      annotationStore.size > 0 &&
      !hasStructuralMarkdownEdit &&
      (hasSourceMultilineInsertion ||
        ((fallbackIsBase || !rejectMatchesBase(canonicalFallback)) &&
          rejectMatchesBase(annotationMd)));

    state.derivedMd = shouldUseAnnotationProjection
      ? annotationMd
      : canonicalFallback;
  }

  function normalizePmCriticMarkdown(md: string): string {
    const structuralDeletionBody =
      "(?=[ \\t]*(?:#{1,6}[ \\t]+|[-*+][ \\t]+|\\d+[.)][ \\t]+|>[ \\t]?|(?:-{3,}|\\*{3,}|_{3,})(?:[ \\t]|--})))";
    return sanitizeEmptyCriticMarkup(md)
      .replace(/^[ \t]{0,3}>[ \t]?\{-->[ \t]?/gm, "{--> ")
      .replace(
        new RegExp(`^#{1,6}[ \\t]+\\{--${structuralDeletionBody}`, "gm"),
        "{--",
      )
      .replace(
        new RegExp(
          `^[ \\t]*(?:[-*+]|\\d+[.)])[ \\t]+\\{--${structuralDeletionBody}`,
          "gm",
        ),
        "{--",
      );
  }

  function isSourceDeletion(
    annotation: ReviewAnnotation,
  ): annotation is DeletionAnnotation {
    return annotation.type === "deletion" && annotation.source === "source";
  }

  function isSourceMultilineInsertion(
    annotation: ReviewAnnotation,
  ): annotation is Extract<ReviewAnnotation, { type: "insertion" }> {
    return (
      annotation.type === "insertion" &&
      annotation.source === "source" &&
      annotation.text.includes("\n")
    );
  }

  function isSourceInsertion(
    annotation: ReviewAnnotation,
  ): annotation is Extract<ReviewAnnotation, { type: "insertion" }> {
    return annotation.type === "insertion" && annotation.source === "source";
  }

  function isPmSafeFragmentOfSourceInsertion(
    annotation: ReviewAnnotation,
    preserved: readonly ReviewAnnotation[],
  ): boolean {
    if (annotation.type !== "insertion") return false;
    if (annotation.text.length === 0) return false;
    const normalizedText = normalizeAnnotationText(annotation.text);
    if (normalizedText.length === 0) return false;
    return preserved.some((sourceAnnotation) => {
      if (!isSourceInsertion(sourceAnnotation)) return false;
      const sourceText = normalizeAnnotationText(sourceAnnotation.text);
      if (sourceText.length === 0) return false;
      const sameText = sourceText === normalizedText;
      const fragment =
        sourceText.includes(normalizedText) ||
        normalizedText.includes(sourceText);
      if (!sameText && !fragment) return false;
      if (sameText) return true;
      return (
        Math.abs(
          annotation.anchor.baseOffset -
            sourceAnnotation.anchor.baseOffset,
        ) <= 240
      );
    });
  }

  function normalizeAnnotationText(text: string): string {
    return text
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+(?=\n|$)/g, "")
      .trim();
  }

  function rangesOverlapOrTouch(
    a: { from: number; to: number },
    b: { from: number; to: number },
  ): boolean {
    return a.from <= b.to && b.from <= a.to;
  }

  function isPmProjectionOfPreservedDeletion(
    annotation: ReviewAnnotation,
    preserved: readonly ReviewAnnotation[],
  ): boolean {
    if (annotation.type !== "deletion") return false;
    const text = normalizeAnnotationText(annotation.deletedText);
    if (text.length === 0) return false;
    const range = {
      from: annotation.anchor.baseOffset,
      to: annotation.anchor.baseOffset + annotation.anchor.baseLength,
    };
    return preserved.some((sourceAnnotation) => {
      if (sourceAnnotation.type !== "deletion") return false;
      if (sourceAnnotation.source !== "source") return false;
      const sourceText = normalizeAnnotationText(sourceAnnotation.deletedText);
      if (sourceText.length === 0) return false;
      const sameText = sourceText === text;
      const fragment =
        sourceText.includes(text) || text.includes(sourceText);
      if (!sameText && !fragment) return false;
      const sourceRange = {
        from: sourceAnnotation.anchor.baseOffset,
        to:
          sourceAnnotation.anchor.baseOffset +
          sourceAnnotation.anchor.baseLength,
      };
      return rangesOverlapOrTouch(range, sourceRange);
    });
  }

  function removePmProjectionDuplicatesOfPreservedAnnotations(
    annotations: readonly ReviewAnnotation[],
    preserved: readonly ReviewAnnotation[],
  ): ReviewAnnotation[] {
    return annotations.filter(
      (annotation) =>
        !isPmSafeFragmentOfSourceInsertion(annotation, preserved) &&
        !isPmProjectionOfPreservedDeletion(annotation, preserved),
    );
  }

  /** PM doc の getMarkdown() から annotations を抽出して store を完全入れ替え */
  function syncAnnotationsFromPm(): void {
    if (!workingWysiwyg) return;
    const md = normalizePmCriticMarkdown(workingWysiwyg.getMarkdown());
    const nodes = parseCritic(md);
    const raw = extractAnnotationsFromNodes(nodes);
    const anchored = reanchorToBase(raw, state.baseOriginal);
    const preserved = annotationStore
      .getAll()
      .filter(
        (annotation) =>
          isSourceDeletion(annotation) ||
          isSourceInsertion(annotation),
      );
    const filtered = removePmProjectionDuplicatesOfPreservedAnnotations(
      anchored,
      preserved,
    );
    annotationStore.clear();
    for (const a of filtered) annotationStore.add(a);
    annotationStore.mergeFrom(preserved);
    updateDerivedMdFromAnnotations(md);
  }

  /** PM doc から annotations を抽出し、既存の store とマージ（source round-trip 用） */
  function mergeAnnotationsFromPm(): void {
    if (!workingWysiwyg) return;
    const md = normalizePmCriticMarkdown(workingWysiwyg.getMarkdown());
    const nodes = parseCritic(md);
    const raw = extractAnnotationsFromNodes(nodes);
    const anchored = reanchorToBase(raw, state.baseOriginal);
    const preserved = annotationStore.getAll();
    const filtered = removePmProjectionDuplicatesOfPreservedAnnotations(
      anchored,
      preserved,
    );
    annotationStore.mergeFrom(filtered);
    updateDerivedMdFromAnnotations(md);
  }

  function syncOrMergeAnnotationsFromPm(): void {
    if (preserveAnnotationsOnNextPmSync) {
      preserveAnnotationsOnNextPmSync = false;
      mergeAnnotationsFromPm();
      return;
    }
    syncAnnotationsFromPm();
  }

  /**
   * plan18 T15.5b: commands.ts の API は `CommandContext` を受ける。
   * editor は呼び出し側で workingWysiwyg.editor を渡すため、null チェック後に組み立てる。
   */
  function buildCommandContext(
    editor: WysiwygEditorHandle["editor"],
  ): CommandContext {
    return {
      editor,
      onEdited: () => {
        if (!sourceRoundTripInProgress) syncOrMergeAnnotationsFromPm();
        onEdited();
        popover.refresh();
        refreshOutline();
        paneSync.refreshDebounced();
        refreshUndoRedoState();
      },
      onCommentDeleteBlocked: () => updateCommentDeleteStatusBar(),
    };
  }

  // plan19 Phase 5 HIGH-4 対処（B5 SFH 沈黙故障）:
  //   ファイル切替を識別するトークン。`onOpenFile` 経路で「現ファイル → 別ファイル」の
  //   切替が確定する直前にインクリメントする。`handleHeadingCrossedDialog` は開始時に
  //   この値を snapshot し、confirm 後に値が変わっていたら onAcceptSingle を呼ばない
  //   ＝沈黙故障（古いクロージャ経由で新ファイルに誤書込み）を防ぐ。
  let fileSwitchToken = 0;
  // ダイアログが開いている数（confirm の入れ子は無いが将来の堅牢性のためカウンタ）。
  // `onOpenFile` が開いたダイアログの存在を検知して、必要なら警告等に使う（現状は監査用）。
  let openDialogCount = 0;

  /**
   * plan19 T29 (HIGH-3 反映): 見出しまたぎ TrimResult を受けて bridge.confirm を
   * kind 別に出し分ける async ヘルパ。preview / source 両経路から共有して呼ぶ。
   *
   * - `single`  → 「見出しを除いた本文だけにコメントしますか？／キャンセル」
   *               OK なら `onAcceptSingle(range)` で再コメント
   * - `multiple` → 「本文範囲が複数に分かれるためキャンセルします（OK ボタンのみ）」
   *               操作中止（confirm を表示するが OK でも何もしない）
   * - `empty`   → 「コメント対象の本文が残っていません（OK ボタンのみ）」
   *               操作中止
   *
   * ## 非同期コールバック整合（design.md §8-5 リスク 2 緩和）
   * confirm 後に state.operations が変わっているケースを想定し、
   * 「再コメント」では現時点の CommandContext / view を **再取得** する責務を
   * 呼び出し側に置く（onAcceptSingle 内で ctx を組み立て直す）。
   *
   * ## ファイル切替レース防御（plan19 Phase 5 HIGH-4 対処）
   * - `snapWysiwyg = workingWysiwyg`、`snapToken = fileSwitchToken` をキャプチャ
   * - confirm から戻った直後（onAcceptSingle 呼ぶ前）に一致を確認
   * - 不一致＝ファイル切替が走った＝古いクロージャ。showError＋早期 return。
   */
  async function handleHeadingCrossedDialog(
    trim: TrimResult,
    onAcceptSingle: (range: { from: number; to: number }) => void,
  ): Promise<void> {
    // plan19 Phase 5 HIGH-4: ファイル切替レース防御（snapshot capture）
    const snapWysiwyg = workingWysiwyg;
    const snapToken = fileSwitchToken;
    openDialogCount += 1;
    try {
      if (trim.kind === "single") {
        const ok = await bridge.confirm({
          message: "見出しを除いた本文だけにコメントしますか？",
          detail:
            "選択範囲に見出し行が含まれていたため、本文部分のみを対象にします。",
        });
        if (!ok) return;
        // ファイル切替が走っていたら onAcceptSingle は古い workingWysiwyg を指す＝
        // 新ファイルに誤った範囲でコメントを書く沈黙故障。明示通知して中断する。
        if (snapWysiwyg !== workingWysiwyg || snapToken !== fileSwitchToken) {
          void bridge.showError({
            message: "コメントを追加できませんでした",
            detail:
              "確認ダイアログ表示中に別のファイルが開かれたため、操作を中断しました。もう一度コメントを付け直してください。",
          });
          return;
        }
        onAcceptSingle({ from: trim.from, to: trim.to });
        return;
      }
      if (trim.kind === "multiple") {
        await bridge.confirm({
          message: "本文範囲が複数に分かれるためキャンセルします。",
          detail:
            "選択範囲に中間の見出し行が含まれており、コメント対象を 1 箇所に絞れません。範囲を選び直してください。",
        });
        return;
      }
      // empty
      await bridge.confirm({
        message: "コメント対象の本文が残っていません。",
        detail:
          "選択範囲が見出し行だけで構成されているため、コメントを付けられません。",
      });
    } finally {
      openDialogCount = Math.max(0, openDialogCount - 1);
    }
  }

  /**
   * plan19 Phase 5.5（TS HIGH-3 対処・2026-06-18）:
   *   `handleHeadingCrossedDialog` の呼び出し点（preview/source × shortcut/popover 4 箇所）は
   *   いずれも同期 UI ハンドラ（runShortcutCommand: boolean / onComment: void）の中にあり、
   *   ハンドラ自体を async 化すると CodeMirror keybinding／popover IPC 経路の戻り値契約を
   *   壊す（return 値が `boolean` 前提で呼ばれている）。
   *   - 旧実装の `void handleHeadingCrossedDialog(...)` は bridge.confirm が reject した時に
   *     promise を silent に飲み込んでいた＝ユーザーは UI 無反応・ログにも残らない。
   *   - 本ヘルパで catch して showError に倒す＝沈黙故障を作らない（純粋な fire-and-forget
   *     OK な showError 通知のみ・本処理は handleHeadingCrossedDialog 内で完結し、
   *     await 完了点での失敗は確実にユーザーに見える）。
   *   - dialog の正常完了（cancel / accept）は handleHeadingCrossedDialog 内で await 済み
   *     なので、本ヘルパが返る時点で operations は確定状態。
   */
  function runHeadingCrossedDialog(
    trim: TrimResult,
    onAcceptSingle: (range: { from: number; to: number }) => void,
  ): void {
    handleHeadingCrossedDialog(trim, onAcceptSingle).catch((error) => {
      // 純粋な通知（showError）は fire-and-forget OK
      console.error("[akapen] handleHeadingCrossedDialog rejected", error);
      const detail = error instanceof Error ? error.message : String(error);
      void bridge.showError({
        message: "見出しまたぎの確認に失敗しました",
        detail,
      });
    });
  }

  // K7: 文字サイズ（%）の現在値。setZoom で一元管理
  let currentFontSize: number = FONT_SIZE_DEFAULT;
  // K7: writeSettings の連続失敗カウンタ（沈黙故障の検知用）
  let fontSizePersistFailures = 0;

  /**
   * K7: 文字サイズの画面反映だけを行う内部ヘルパ（永続化なし）。
   * setZoom（ユーザー操作＝永続化込み）と起動時復元（永続化不要）の共通部。
   * shortcutPanel/marginNotes/paneSync は後方初期化の const。呼び出しは原則初期化後だが、
   * 起動時 IIFE 順や将来の編集で呼び出し順が前後しても TDZ で静かに落ちないよう defensive guard。
   */
  function applyZoomState(pct: number): number {
    const clamped = Math.max(
      FONT_SIZE_MIN,
      Math.min(FONT_SIZE_MAX, Math.round(pct)),
    );
    currentFontSize = clamped;
    document.documentElement.style.setProperty(
      "--font-zoom",
      String(clamped / 100),
    );
    // TDZ ガード: 初期化前呼び出しは画面反映の CSS 変数だけ更新して return（次回呼び出しで shortcutPanel に同期）
    if (
      typeof shortcutPanel === "undefined" ||
      typeof marginNotes === "undefined" ||
      typeof paneSync === "undefined"
    ) {
      return clamped;
    }
    shortcutPanel.setFontSize(clamped);
    refreshZoomLayout();
    return clamped;
  }

  /** K7: 文字サイズを即反映・永続化・パネル表示を同期する（スライダー/メニュー/手入力の合流点） */
  async function setZoom(pct: number): Promise<void> {
    const clamped = applyZoomState(pct);
    try {
      await bridge.writeSettings({ version: 1, fontSize: clamped });
      fontSizePersistFailures = 0;
    } catch (error) {
      // 単発失敗はコンソールのみ（バナー過剰回避）。連続3回でログレベルを上げて気づける状態にする。
      fontSizePersistFailures += 1;
      if (fontSizePersistFailures >= 3) {
        console.error(
          "[akapen] font-size persist failed (3+ times in a row)",
          error,
        );
      } else {
        console.warn("[akapen] font-size persist failed", error);
      }
    }
  }

  /**
   * K7: 文字サイズ変更後の位置再計算。フォントが変わる＝折返し・行高が変わるため、
   * 欄外注・視覚スペーサー・行整列を追従させる（F4 ドラッグ時と同じ3点セット。
   * marginNotes/paneSync は後方初期化の const だが、呼び出しは必ず初期化後＝
   * TDZ に当たらない。未読込時は各自のガードで no-op）。
   */
  function refreshZoomLayout(): void {
    marginNotes.refresh();
    paneSync.refresh();
    scheduleAlignment();
  }

  /** K7: メニューからのズーム操作（delta=0: reset, 1: +5, -1: -5） */
  function applyMenuFontSize(delta: number): void {
    if (delta === 0) {
      void setZoom(FONT_SIZE_DEFAULT);
    } else {
      void setZoom(currentFontSize + delta * FONT_SIZE_STEP);
    }
  }

  // --- 自動保存（Task 7）: 初回編集は即時・以降 1秒 debounce・切替/完了直前に即時 flush ---
  let autosaveTimer: number | null = null;
  let autosaveExists = false; // この base の autosave エントリが存在するか（初回編集の即時保存判定）
  let autosaveDirty = false; // 前回 write 以降に未保存の変更があるか（flush 用）
  // loadingEditors は前段（subscribe 配線より前）で宣言済み（Phase 7.5 で順序入替）。

  const cancelAutosaveTimer = (): void => {
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  };

  /**
   * 自動保存の即時 write（plan18 T15.5b・AutosaveEntryV2 形式）。
   *
   * - schemaVersion 2 = { version:2, baseRaw, operations, redoStack, ... }。
   * - operations / redoStack は OperationStore.persist() のスナップショット。
   * - 失敗は赤バナーで可視化（添削は続行可）。autosaveDirty は成功時のみ false に落とす。
   */
  async function writeAutosaveNow(): Promise<void> {
    if (!state.basePath || !state.baseStat) return;
    cancelAutosaveTimer();
    autosaveExists = true;
    // plan30 Phase 5: PM doc の markdown + baseRaw を保存するシンプルな形式。
    const currentMd = workingWysiwyg ? workingWysiwyg.getMarkdown() : "";
    const entry: AutosaveEntry = {
      version: 2,
      basePath: state.basePath,
      baseOriginal: state.baseOriginal,
      baseStat: state.baseStat,
      baseRaw: state.baseRaw,
      operations: [],
      redoStack: [],
      globalNote: state.globalNote,
      savedAt: new Date().toISOString(),
      annotations: annotationStore.snapshot(),
    };
    let result: { status: "ok" } | { status: "error"; message: string };
    try {
      result = await bridge.autosave.write(entry);
    } catch (error) {
      result = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (state.basePath !== entry.basePath) return;
    if (result.status === "ok") {
      void currentMd;
      if (state.globalNote === entry.globalNote) {
        autosaveDirty = false;
      }
      banners.hideAutosaveFailed();
    } else {
      banners.showAutosaveFailed(result.message);
    }
  }

  /** operations / globalNote が変わった時に呼ぶ（autosave のスケジューリング） */
  function onEdited(): void {
    if (loadingEditors || !state.basePath) return;
    autosaveDirty = true;
    if (!autosaveExists) {
      void writeAutosaveNow(); // 初回編集は即時保存（失敗は内部でバナー表示＝reject しない）
      return;
    }
    cancelAutosaveTimer();
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      void writeAutosaveNow();
    }, 1000);
  }

  /**
   * モード切替・完了直前の即時 write（未保存変更がある時だけ）。
   * plan19 Phase 5 HIGH-4: 旧実装は `void writeAutosaveNow()` で IPC 完了を待たずに
   *   戻っていた＝onOpenFile 経路で `openFile` が autosave 完了前に走り「現ファイルの
   *   autosave が新ファイル load 中に副作用を出す」沈黙レースの温床。Promise を返して
   *   呼び出し側で await できるようにする（既存の `void flushAutosave()` 呼び出し点は
   *   挙動を変えない＝fire-and-forget のまま）。
   */
  function flushAutosave(): Promise<void> {
    if (autosaveDirty) return writeAutosaveNow();
    return Promise.resolve();
  }

  // --- DOM 骨格（空状態⇄編集状態） ---
  const appEl = document.createElement("div");
  appEl.className = "akapen-app";
  appEl.innerHTML = `
    <main class="akapen-main">
      <section class="akapen-empty">
        <p>レビューする .md ファイルを開いてください。</p>
        <button type="button" data-action="empty-open">ファイルを開く</button>
        <div data-role="resume-list"></div>
      </section>
      <section class="akapen-workspace is-hidden">
        <div class="akapen-pane akapen-pane--base">
          <div class="akapen-pane-title akapen-pane-title--base">🔒元データ（読み取り専用）</div>
          <div class="akapen-pane-body">
            <div class="akapen-editor" data-editor="base-preview"></div>
            <div class="akapen-editor is-hidden" data-editor="base-source"></div>
          </div>
        </div>
        <div class="akapen-divider" data-role="pane-divider" role="separator" aria-orientation="vertical" aria-label="左右ペインの境界"></div>
        <div class="akapen-pane akapen-pane--working">
          <div class="akapen-pane-title akapen-pane-title--working">✎作業エリア</div>
          <div class="akapen-pane-body">
            <div class="akapen-editor" data-editor="working-preview"></div>
            <div class="akapen-editor is-hidden" data-editor="working-source"></div>
          </div>
        </div>
      </section>
    </main>
    <div class="akapen-statusbar" aria-live="polite"></div>
  `;

  // K3.5 段階2（plan7）: ステータス行の更新関数。
  // 3秒で自動消滅・連続弾きで前のタイマーをクリアして最新メッセージに上書き。
  // doc には一切書かない（条件 UI-1）。
  const statusbarEl = appEl.querySelector<HTMLDivElement>(".akapen-statusbar")!;
  let statusbarTimer: number | null = null;
  function updateStatusBar(detectedDelimiter: string): void {
    if (statusbarTimer !== null) {
      window.clearTimeout(statusbarTimer);
      statusbarTimer = null;
    }
    statusbarEl.textContent = `この記号（${detectedDelimiter}）は使えません`;
    statusbarTimer = window.setTimeout(() => {
      statusbarTimer = null;
      statusbarEl.textContent = "";
    }, 3000);
  }
  // M-6（段階5）: 全 noop 上書き時のステータス行通知（段階2 statusbar の流用）。
  // handleTextInput で上書きを全破棄した場面に呼ばれる。
  function updateNoopStatusBar(): void {
    if (statusbarTimer !== null) {
      window.clearTimeout(statusbarTimer);
      statusbarTimer = null;
    }
    statusbarEl.textContent = "この箇所は編集できません";
    statusbarTimer = window.setTimeout(() => {
      statusbarTimer = null;
      statusbarEl.textContent = "";
    }, 3000);
  }

  // plan18 T16: コメント範囲含む削除をブロックした時の 3 秒通知。
  function updateCommentDeleteStatusBar(): void {
    if (statusbarTimer !== null) {
      window.clearTimeout(statusbarTimer);
      statusbarTimer = null;
    }
    statusbarEl.textContent = "コメント範囲を含む削除はできません";
    statusbarTimer = window.setTimeout(() => {
      statusbarTimer = null;
      statusbarEl.textContent = "";
    }, 3000);
  }

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = appEl.querySelector<T>(selector);
    if (!el) throw new Error(`app: ${selector} not found`);
    return el;
  };
  const emptyEl = query<HTMLElement>(".akapen-empty");
  const workspaceEl = query<HTMLElement>(".akapen-workspace");
  const resumeListEl = query<HTMLDivElement>('[data-role="resume-list"]');
  const basePreviewEl = query<HTMLDivElement>('[data-editor="base-preview"]');
  const baseSourceEl = query<HTMLDivElement>('[data-editor="base-source"]');
  const workingPreviewEl = query<HTMLDivElement>(
    '[data-editor="working-preview"]',
  );
  const workingSourceEl = query<HTMLDivElement>(
    '[data-editor="working-source"]',
  );
  // plan19 Phase 5.5（TS HIGH-2 対処・2026-06-18）:
  //   旧実装は `parentElement as HTMLElement` で null cast で消していたが、
  //   `parentElement` は `HTMLElement | null`＝レイアウト崩壊時に null になりうる。
  //   起動時のみの一回チェックなので throw して fail-fast にする（沈黙故障回避）。
  const workingPaneBody = workingPreviewEl.parentElement;
  if (!workingPaneBody)
    throw new Error("app: workingPreviewEl has no parent (.akapen-pane-body)");
  const basePaneBody = basePreviewEl.parentElement;
  if (!basePaneBody)
    throw new Error("app: basePreviewEl has no parent (.akapen-pane-body)");

  // G5: 行整列エクステンション（base/working の両ペイン用）
  const alignmentExt = createAlignmentExtension();
  let alignmentHandle: ReturnType<typeof alignmentExt.connect> | null = null;

  // G5: source docChanged 時に整列を再計算するスケジューラー（debounce 150ms + rAF）
  let alignDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleAlignment(): void {
    if (!baseSource || !workingSource) return;
    if (alignDebounceTimer !== null) clearTimeout(alignDebounceTimer);
    alignDebounceTimer = setTimeout(() => {
      alignDebounceTimer = null;
      if (alignmentHandle && baseSource && workingSource) {
        alignmentHandle.update(baseSource.getText(), workingSource.getText());
      }
    }, 150);
  }

  const toolbar = createToolbar({
    onOpen: () => {
      void openViaDialog();
    },
    // F7: セグメント切替＝モード指定。現在モードと同じ押下は no-op（切替ロジックは
    // toggleViewMode 1本のまま＝reconcile/IntegrityError ガードを迂回しない）
    onSelectViewMode: (mode) => {
      if (mode !== state.viewMode) toggleViewMode();
    },
    // G4: TOC パネルのトグル
    onTocToggle: () => {
      tocPanel.toggle();
      toolbar.setTocOpen(tocPanel.isOpen());
    },
    onSave: () => {
      void completeReview();
    },
    onSaveAs: () => {
      void saveReviewAs();
    },
    onUndo: () => {
      runUndo();
    },
    onRedo: () => {
      runRedo();
    },
    onGlobalNote: (value) => {
      if (value !== state.globalNote) {
        state.globalNote = value;
        onEdited();
      }
    },
    onShortcutSettings: () => {
      shortcutPanel.toggle();
    },
  });
  appEl.prepend(toolbar.element);
  const shortcutPanel = createShortcutSettingsPanel({
    commands: SHORTCUT_COMMANDS,
    bindings: shortcutBindings,
    onChange: (commandId, binding) =>
      persistShortcutBindings({ ...shortcutBindings, [commandId]: binding }),
    onReset: () => persistShortcutBindings({ ...DEFAULT_SHORTCUT_BINDINGS }),
    onFontSizeChange: (pct) => {
      void setZoom(pct);
    },
    initialFontSize: currentFontSize,
  });
  appEl.appendChild(shortcutPanel.element);
  // バナー（ガード②③）＝ツールバー直下に常設・完了パネルは overlay
  const banners = createBanners();
  toolbar.element.after(banners.element);
  const completionPanel = createCompletionPanel();
  appEl.appendChild(completionPanel.element);

  // G4: TOC パネル（右側からスライドイン）
  const tocPanel = createTocPanel({
    onToggle: (open) => {
      toolbar.setTocOpen(open);
      marginNotes.refresh();
      paneSync.refresh();
    },
    onJump: (index) => {
      jumpToHeading(index);
    },
  });
  appEl.appendChild(tocPanel.element);
  query<HTMLButtonElement>('[data-action="empty-open"]').addEventListener(
    "click",
    () => {
      void openViaDialog();
    },
  );
  root.appendChild(appEl);

  // plan30 Phase 5: PM 標準 history ベースの undo/redo 状態判定。
  function activeUndoRedoState(): { canUndo: boolean; canRedo: boolean } {
    if (!state.basePath || !workingWysiwyg)
      return { canUndo: false, canRedo: false };
    return {
      canUndo: workingWysiwyg.undoDepth() > 0,
      canRedo: workingWysiwyg.redoDepth() > 0,
    };
  }

  function refreshUndoRedoState(): void {
    const { canUndo, canRedo } = activeUndoRedoState();
    toolbar.setUndoRedoState(canUndo, canRedo);
  }
  // plan30 Phase 5: PM 標準 history に統一。
  function runUndo(): boolean {
    if (!workingWysiwyg) return false;
    const applied = workingWysiwyg.undo();
    if (applied) {
      popover.refresh();
      refreshOutline();
      paneSync.refreshDebounced();
    }
    refreshUndoRedoState();
    return applied;
  }

  function runRedo(): boolean {
    if (!workingWysiwyg) return false;
    const applied = workingWysiwyg.redo();
    if (applied) {
      popover.refresh();
      refreshOutline();
      paneSync.refreshDebounced();
    }
    refreshUndoRedoState();
    return applied;
  }

  function afterShortcutEdit(applied: boolean): boolean {
    if (applied) {
      popover.refresh();
      refreshOutline();
      paneSync.refreshDebounced();
      refreshUndoRedoState();
    }
    return applied;
  }

  type LineFormattingCommand = "heading-1" | "heading-2" | "heading-3" | "bullet";

  function selectedPreviewText(): string | null {
    if (!workingWysiwyg) return null;
    return workingWysiwyg.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { from, to, empty } = view.state.selection;
      if (empty) return null;
      return view.state.doc.textBetween(from, to, "\n", "\n");
    });
  }

  function findMarkdownLineRange(md: string, selectedText: string): { from: number; to: number } | null {
    const trimmed = selectedText.trim();
    if (trimmed.length === 0) return null;
    const head = trimmed.slice(0, Math.min(16, trimmed.length));
    const tail = trimmed.slice(Math.max(0, trimmed.length - 16));
    const start = md.indexOf(head);
    if (start < 0) return null;
    const tailStart = md.indexOf(tail, start);
    const end = tailStart >= 0 ? tailStart + tail.length : start + head.length;
    return {
      from: md.lastIndexOf("\n", Math.max(0, start - 1)) + 1,
      to: (() => {
        const lineEnd = md.indexOf("\n", end);
        return lineEnd < 0 ? md.length : lineEnd;
      })(),
    };
  }

  function formatMarkdownLines(
    md: string,
    range: { from: number; to: number },
    command: LineFormattingCommand,
  ): string {
    const target = md.slice(range.from, range.to);
    const lines = target.split("\n");
    const headingLevel =
      command === "heading-1" ? 1 : command === "heading-2" ? 2 : command === "heading-3" ? 3 : 0;
    const formatted = lines
      .map((line) => {
        if (line.trim().length === 0) return line;
        const indent = line.match(/^\s*/)?.[0] ?? "";
        const body = line.slice(indent.length);
        if (headingLevel > 0) {
          return `${indent}${"#".repeat(headingLevel)} ${body.replace(/^#{1,6}\s+/, "")}`;
        }
        if (/^(?:[-*+]|\d+\.)\s+/.test(body)) return line;
        return `${indent}- ${body}`;
      })
      .join("\n");
    return md.slice(0, range.from) + formatted + md.slice(range.to);
  }

  function applyMarkdownLineFormatting(command: LineFormattingCommand): boolean {
    if (!workingWysiwyg || state.viewMode !== "preview") return false;
    if (selectionHasDeletionMark(buildCommandContext(workingWysiwyg.editor))) {
      return false;
    }
    const selected = selectedPreviewText();
    if (!selected) return false;
    const md = canonicalizeBrLines(workingWysiwyg.getMarkdown());
    const range = findMarkdownLineRange(md, selected);
    if (!range) return false;
    const nextMd = formatMarkdownLines(md, range, command);
    if (nextMd === md) return false;
    setWorkingMarkdownWithFallback(nextMd);
    syncAnnotationsFromPm();
    state.derivedMd = nextMd;
    previewMarkdownFormattingDirty = true;
    onEdited();
    return true;
  }

  /**
   * F8 整形（見出し/太字/箇条書き）の preview 事前ガード（plan3b §2）。
   * これらは可視テキストに出ない構造変化＝生テキスト折り込みに閉じ込められない（fold は
   * structural-change LOUD_STOP で止める）。入口で止めて showError し、無音消失を作らない。
   * fold 層の structural-change 網は最終防衛線として残る（多重防御）。
   * 返り値 true＝ガード発動（呼び出し側は dispatch せず終了）。
   *
   * ⚠️ K3.5 段階3（plan8 §4-app.ts）: F8 太字 **解除**だけは preview で完結する。
   * `case 'format-bold'` / `onBold` から最初に attemptRemoveBoldByOriginInPreview() を呼び、
   * 「解除でない」と判明した時のみここに落ちて showError する。
   */
  function guardPreviewFormatting(): boolean {
    if (state.viewMode !== "preview") return false;
    void bridge.showError({
      message: "整形はコード表示で行ってください",
      detail:
        "見出し・太字・箇条書きなどの整形はビュワーでは取り込めません。コード表示に切り替えて編集してください。",
    });
    return true;
  }

  // plan18 T15.5b: 旧 attemptRemoveBoldByOriginInPreview / writeBackWorkingMdFromUiEdit
  // （K3.5 段階3 の F8 太字解除分岐・workingMd 直接書き換え）は廃止。
  //   - 旧実装は strong-align / own-bold / blockSafeCritic / canonicalizeBrLines に依存し
  //     state.workingMd を真実源として直接更新していた。
  //   - 新仕様（Operations List）では F8 整形は plan19 で operations-to-critic 上に再構築する。
  //   - plan18 中はビュワー（preview）モードの F8 は guardPreviewFormatting() で
  //     「コード表示で行ってください」に倒す（design.md §2 OUT・整形は plan19 持ち越し）。

  function runShortcutCommand(commandId: ShortcutCommandId): boolean {
    if (!state.basePath) return false;
    switch (commandId) {
      case "delete-mark":
        if (state.viewMode === "preview") {
          return afterShortcutEdit(
            workingWysiwyg
              ? applyDeletion(buildCommandContext(workingWysiwyg.editor))
              : false,
          );
        }
        return afterShortcutEdit(
          workingSource ? applySourceDeletion(workingSource.view) : false,
        );
      case "comment": {
        const instruction = state.globalNote.trim();
        if (!instruction) return false;
        if (state.viewMode === "preview") {
          if (!workingWysiwyg) return false;
          // plan19 T29 (HIGH-3): 見出しまたぎ guard を CommandContext.onHeadingCrossed
          // 経由で配線。交差時は applyComment が false 返却し、bridge.confirm 経由で
          // ダイアログを出す（async・shortcut の同期戻り値は false で問題なし＝
          // afterShortcutEdit は edit 後処理を skip するが、再コメント時に
          // applyCommentAtRange → onEdited 経路で発火する）。
          const editor = workingWysiwyg.editor;
          const ctx: CommandContext = {
            ...buildCommandContext(editor),
            onHeadingCrossed: (trim) => {
              // plan19 Phase 5.5: dialog reject 時の沈黙故障を runHeadingCrossedDialog の
              //   catch で showError へ倒す（TS HIGH-3 対処）。
              runHeadingCrossedDialog(trim, (range) => {
                if (!workingWysiwyg) return;
                const ctx2 = buildCommandContext(workingWysiwyg.editor);
                const applied = applyCommentAtRange(ctx2, instruction, range);
                if (applied) afterShortcutEdit(true);
              });
            },
          };
          return afterShortcutEdit(applyComment(ctx, instruction));
        }
        return afterShortcutEdit(applySourceCommentFromSelection(instruction));
      }
      case "remove-marks":
        return afterShortcutEdit(
          state.viewMode === "preview" && workingWysiwyg
            ? removeCriticMarks(buildCommandContext(workingWysiwyg.editor))
            : false,
        );
      // plan15 H2: 削除マーク解除専用ケース（Mod-Shift-X でコンテキスト判定して動的ルーティング）
      // M1: remove-marks の defaultBinding を '' にしたため commandIdForBinding は remove-deletion を返す。
      // 選択範囲に comment マークがある場合は removeCommentMark、そうでなければ removeDeletionMark を呼ぶ。
      case "remove-deletion": {
        if (state.viewMode !== "preview" || !workingWysiwyg) return false;
        const ctx = buildCommandContext(workingWysiwyg.editor);
        const hasComment = selectionHasCommentMark(ctx);
        return afterShortcutEdit(
          hasComment ? removeCommentMark(ctx) : removeDeletionMark(ctx),
        );
      }
      // plan15 H2: コメント削除専用ケース（PopOver の「コメント削除」ボタンから直接呼ばれる）
      // キーボード経由は remove-deletion case が担う（M1 コンテキスト判定）。
      case "remove-comment":
        return afterShortcutEdit(
          state.viewMode === "preview" && workingWysiwyg
            ? removeCommentMark(buildCommandContext(workingWysiwyg.editor))
            : false,
        );
      case "format-heading-1":
        return afterShortcutEdit(
          state.viewMode === "preview" && workingWysiwyg
            ? applyMarkdownLineFormatting("heading-1") ||
                (() => {
                const applied = applyHeading(
                  buildCommandContext(workingWysiwyg.editor),
                  1,
                );
                if (applied) previewMarkdownFormattingDirty = true;
                return applied;
              })()
            : false,
        );
      case "format-heading-2":
        return afterShortcutEdit(
          state.viewMode === "preview" && workingWysiwyg
            ? applyMarkdownLineFormatting("heading-2") ||
                (() => {
                const applied = applyHeading(
                  buildCommandContext(workingWysiwyg.editor),
                  2,
                );
                if (applied) previewMarkdownFormattingDirty = true;
                return applied;
              })()
            : false,
        );
      case "format-heading-3":
        return afterShortcutEdit(
          state.viewMode === "preview" && workingWysiwyg
            ? applyMarkdownLineFormatting("heading-3") ||
                (() => {
                const applied = applyHeading(
                  buildCommandContext(workingWysiwyg.editor),
                  3,
                );
                if (applied) previewMarkdownFormattingDirty = true;
                return applied;
              })()
            : false,
        );
      case "format-bold":
        return afterShortcutEdit(
          state.viewMode === "preview" && workingWysiwyg
            ? (() => {
                const applied = toggleBold(
                  buildCommandContext(workingWysiwyg.editor),
                );
                if (applied) previewMarkdownFormattingDirty = true;
                return applied;
              })()
            : false,
        );
      case "format-bullet-list":
        return afterShortcutEdit(
          state.viewMode === "preview" && workingWysiwyg
            ? applyMarkdownLineFormatting("bullet") ||
                (() => {
                const applied = applyBulletList(
                  buildCommandContext(workingWysiwyg.editor),
                );
                if (applied) previewMarkdownFormattingDirty = true;
                return applied;
              })()
            : false,
        );
      case "save":
        void completeReview();
        return true;
      case "toggle-view":
        toggleViewMode();
        return true;
      case "undo":
        return runUndo();
      case "redo":
        return runRedo();
      default:
        return false;
    }
  }

  function handleShortcutKey(event: KeyboardEvent): boolean {
    const binding = normalizeShortcutEvent(event);
    if (!binding) return false;
    const commandId = commandIdForBinding(shortcutBindings, binding);
    if (commandId) {
      event.preventDefault();
      event.stopPropagation();
      return runShortcutCommand(commandId);
    }
    if (isKnownDefaultBinding(binding)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  }

  function createCodeMirrorShortcutExtension(): Extension {
    const assigned = new Set(Object.values(shortcutBindings));
    const entries = SHORTCUT_COMMANDS.map((command) => ({
      key: bindingToCodeMirrorKey(shortcutBindings[command.id]),
      run: () => runShortcutCommand(command.id),
    }));
    for (const binding of Object.values(DEFAULT_SHORTCUT_BINDINGS)) {
      if (assigned.has(binding)) continue;
      entries.push({ key: bindingToCodeMirrorKey(binding), run: () => true });
    }
    return Prec.highest(keymap.of(entries));
  }

  function reconfigureSourceShortcuts(): void {
    workingSource?.setShortcutExtension(createCodeMirrorShortcutExtension());
  }

  async function persistShortcutBindings(
    next: ShortcutBindings,
  ): Promise<boolean> {
    let result: { status: "ok" } | { status: "error"; message: string };
    try {
      result = await bridge.writeShortcuts(shortcutSettingsFromBindings(next));
    } catch (error) {
      result = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.status === "error") {
      void bridge.showError({
        message: "ショートカットを保存できませんでした",
        detail: result.message,
      });
      return false;
    }
    shortcutBindings = { ...next };
    shortcutPanel.setBindings(shortcutBindings);
    reconfigureSourceShortcuts();
    return true;
  }

  void (async () => {
    try {
      shortcutBindings = createShortcutBindings(await bridge.readShortcuts());
      shortcutPanel.setBindings(shortcutBindings);
      reconfigureSourceShortcuts();
    } catch (error) {
      void bridge.showError({
        message: "ショートカット設定を読み込めませんでした",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  // K7: 文字サイズの永続設定を起動時に読み込んで即反映
  // （applyZoomState＝画面反映のみ。setZoom は writeSettings を呼ぶため起動時は使わない＝読込み直後の再書込みを作らない）
  void (async () => {
    try {
      const saved = await bridge.readSettings();
      applyZoomState(saved.fontSize);
    } catch {
      // 読込み失敗は既定値のまま
    }
  })();

  const onDocumentShortcutKey = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".akapen-shortcuts-panel")) return;
    if (target?.closest(".akapen-editor")) return;
    const binding = normalizeShortcutEvent(event);
    if (!binding) return;
    const commandId = commandIdForBinding(shortcutBindings, binding);
    if (!commandId) return;
    if (!["save", "toggle-view", "undo", "redo"].includes(commandId)) return;
    event.preventDefault();
    event.stopPropagation();
    runShortcutCommand(commandId);
  };
  document.addEventListener("keydown", onDocumentShortcutKey, true);

  // 選択ポップオーバー（3操作の入口）＝右ペイン対象。
  // F6: source（CM6）でも削除/コメントを出す（マーク解除・整形は preview 専用）。
  // 削除/コメントの適用はモードで分岐＝preview は PM の addMark、source は記法文字列の
  // 挿入（source-redpen.ts）。どちらも「データに記法が入る」正規の編集で結果形は同じ。
  const popover = createSelectionPopover({
    container: workingPaneBody,
    getTarget: () => {
      if (state.viewMode === "preview") {
        if (!workingWysiwyg) return null;
        const view = workingWysiwyg.editor.action((ctx) =>
          ctx.get(editorViewCtx),
        );
        const { empty, to } = view.state.selection;
        return {
          kind: "preview",
          empty,
          coords: empty ? null : view.coordsAtPos(to),
        };
      }
      if (!workingSource) return null;
      const sel = workingSource.view.state.selection.main;
      return {
        kind: "source",
        empty: sel.empty,
        coords: sel.empty ? null : workingSource.view.coordsAtPos(sel.to),
      };
    },
    onDelete: () => {
      if (state.viewMode === "preview") {
        if (workingWysiwyg)
          applyDeletion(buildCommandContext(workingWysiwyg.editor));
      } else if (workingSource) {
        applySourceDeletion(workingSource.view);
      }
    },
    onComment: (instruction) => {
      // plan19 T29 (HIGH-3 反映): 見出しまたぎ guard を popover 経路にも配線。
      // preview/source 両経路で同じ handleHeadingCrossedDialog を共有する
      // （divergence 防止＝退避策ゲート対象）。
      if (state.viewMode === "preview") {
        if (!workingWysiwyg) return;
        const editor = workingWysiwyg.editor;
        const ctx: CommandContext = {
          ...buildCommandContext(editor),
          onHeadingCrossed: (trim) => {
            // plan19 Phase 5.5: dialog reject 時の沈黙故障を runHeadingCrossedDialog の
            //   catch で showError へ倒す（TS HIGH-3 対処）。
            runHeadingCrossedDialog(trim, (range) => {
              if (!workingWysiwyg) return;
              const ctx2 = buildCommandContext(workingWysiwyg.editor);
              applyCommentAtRange(ctx2, instruction, range);
            });
          },
        };
        applyComment(ctx, instruction);
      } else if (workingSource) {
        afterShortcutEdit(applySourceCommentFromSelection(instruction));
      }
    },
    onRemoveMarks: () => {
      if (workingWysiwyg)
        removeCriticMarks(buildCommandContext(workingWysiwyg.editor));
    },
    // plan15 C-2: PopOver コンテキスト別ボタン制御
    // 選択範囲のマーク種別を返す（'deletion' / 'comment' / 'plain'）。
    // popover.ts の updateContextButtons が「削除解除」「コメント削除」を切り替える。
    getMarkContext: () => {
      if (state.viewMode !== "preview" || !workingWysiwyg) return null;
      const ctx = buildCommandContext(workingWysiwyg.editor);
      if (selectionHasCommentMark(ctx)) return "comment";
      if (selectionHasDeletionMark(ctx)) return "deletion";
      return "plain";
    },
    onRemoveDeletion: () => {
      afterShortcutEdit(
        state.viewMode === "preview" && workingWysiwyg
          ? removeDeletionMark(buildCommandContext(workingWysiwyg.editor))
          : false,
      );
    },
    // F8: Markdown 整形（Milkdown コマンド）。K3案B 段階2+3（plan3b §2）: preview では
    // 事前ガードで止めてコード表示へ誘導する（plan18 T15.5b: F8 太字解除の workingMd 直接
    // 書き換え経路は廃止＝plan19 で operations-to-critic 上に再構築）。
    onHeading: (level) => {
      if (!workingWysiwyg) return;
      const applied =
        applyMarkdownLineFormatting(`heading-${level}` as LineFormattingCommand) ||
        applyHeading(buildCommandContext(workingWysiwyg.editor), level);
      if (applied) previewMarkdownFormattingDirty = true;
    },
    onBold: () => {
      if (!workingWysiwyg) return;
      const applied = toggleBold(buildCommandContext(workingWysiwyg.editor));
      if (applied) previewMarkdownFormattingDirty = true;
    },
    onBulletList: () => {
      if (!workingWysiwyg) return;
      const applied =
        applyMarkdownLineFormatting("bullet") ||
        applyBulletList(buildCommandContext(workingWysiwyg.editor));
      if (applied) previewMarkdownFormattingDirty = true;
    },
  });

  // コメント欄外注（引き出し線つき・常時表示＝Task 9。preview モードでだけ表示）
  // plan15 H1: onEditComment コールバックを渡すことで実機 UI 経路での編集が機能する
  // plan15 追加修正 A: onRemoveComment でコメントポップアップの「コメント削除」ボタンを配線
  const marginNotes = createMarginNotes({
    paneBody: workingPaneBody,
    editorRoot: workingPreviewEl,
    onEditComment: (newInstruction: string, commentEl: HTMLElement) => {
      if (workingWysiwyg) {
        // H3 改善: commentEl を渡して PM posAtDOM で正確な位置を特定する
        editComment(
          buildCommandContext(workingWysiwyg.editor),
          newInstruction,
          { commentEl },
        );
      }
    },
    onRemoveComment: (commentEl: HTMLElement) => {
      if (workingWysiwyg) {
        // commentEl から PM 座標を特定して removeCommentMark を呼ぶ
        afterShortcutEdit(
          removeCommentMark(buildCommandContext(workingWysiwyg.editor), {
            commentEl,
          }),
        );
      }
    },
  });

  // plan20 T14（HLD v3 §5.6・2026-06-18）: source モード用コメント popup の配線。
  //   preview と同じ comment-popup を使うが、selector / instruction 抽出口だけ差し替え。
  const sourceCommentPopup = createCommentPopup({
    paneBody: workingPaneBody,
    editorRoot: workingSourceEl,
    targetSelector: `.${SOURCE_COMMENT_HIGHLIGHT_CLASS}`,
    readInstruction: (el) =>
      el.getAttribute(SOURCE_COMMENT_INSTRUCTION_ATTR) ?? "",
    onEditConfirm: (newInstruction, commentEl) => {
      if (workingWysiwyg) {
        editComment(
          buildCommandContext(workingWysiwyg.editor),
          newInstruction,
          { commentEl },
        );
      }
    },
    onRemoveComment: (commentEl) => {
      if (workingWysiwyg) {
        removeCommentMark(buildCommandContext(workingWysiwyg.editor), {
          commentEl,
        });
      }
    },
  });

  // F2: 左右連動スクロール＋視覚スペーサー（表示のみ＝元データに一切書き込まない）。
  // スクロール連動は両モード常時・スペーサーは preview のみ・再計算は編集 debounce。
  const paneSync = createPaneSync({
    basePaneBody,
    workingPaneBody,
    baseEditorRoot: basePreviewEl,
    workingEditorRoot: workingPreviewEl,
  });

  // K2: センターラインは固定（50:50・grid 1fr 1px 1fr）。F4 のドラッグ調整は廃止。

  // --- F5: 右上の見出しプルダウン（アウトラインジャンプ） ---
  // 一覧は現モードの実体（preview＝PM doc の heading ノード／source＝CM6 テキストの
  // ATX 行）から都度生成（H1〜H3 のみ）。ジャンプは表示のスクロールだけ＝元データ
  // （workingMd／base）には一切書き込まない。

  interface OutlineTarget {
    level: number;
    text: string;
    pos: number; // preview＝PM ノード位置／source＝CM6 文字オフセット（行頭）
  }

  /** ATX 見出し（H1〜H3）を行単位で拾う。fenced code（```/~~~）内は見出し扱いしない */
  function collectSourceOutline(text: string): OutlineTarget[] {
    const targets: OutlineTarget[] = [];
    let offset = 0;
    let fence: string | null = null; // 開いている fence の文字（` or ~）
    for (const line of text.split("\n")) {
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const char = fenceMatch[1][0];
        if (!fence) fence = char;
        else if (char === fence) fence = null;
      } else if (!fence) {
        const m = /^ {0,3}(#{1,3})[ \t]+(.*\S)[ \t]*$/.exec(line);
        if (m) {
          targets.push({
            level: m[1].length,
            text: m[2].replace(/[ \t]+#+$/, ""), // 閉じ #（ATX closing sequence）は表示しない
            pos: offset,
          });
        }
      }
      offset += line.length + 1;
    }
    return targets;
  }

  /** preview＝PM doc から heading ノード（level 1〜3）を拾う */
  function collectPreviewOutline(): OutlineTarget[] {
    if (!workingWysiwyg) return [];
    const targets: OutlineTarget[] = [];
    workingWysiwyg.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      doc.descendants((node, pos) => {
        if (node.type.name !== "heading") return true;
        const level = Number(node.attrs.level);
        if (level >= 1 && level <= 3)
          targets.push({ level, text: node.textContent, pos });
        return false; // 見出しの中に下位見出しは無い
      });
    });
    return targets;
  }

  function collectOutline(): OutlineTarget[] {
    if (!state.basePath) return [];
    if (state.viewMode === "preview") return collectPreviewOutline();
    return workingSource ? collectSourceOutline(workingSource.getText()) : [];
  }

  /** 目次一覧を現ドキュメントから作り直す（同内容なら DOM 温存） */
  function refreshOutline(): void {
    const items = collectOutline().map(({ level, text }) => ({ level, text }));
    tocPanel.setItems(items); // G4: TOC パネルに反映
  }

  /** 選択された見出し位置へスクロール（一覧が古くても現ドキュメントで解決し直す） */
  function jumpToHeading(index: number): void {
    const target = collectOutline()[index];
    if (!target) return;
    if (state.viewMode === "preview" && workingWysiwyg) {
      workingWysiwyg.editor.action((ctx) => {
        const dom = ctx.get(editorViewCtx).nodeDOM(target.pos);
        if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
      });
    } else if (state.viewMode === "source" && workingSource) {
      // CM6: effects のみの dispatch（doc 変更なし＝changeFilter 非対象）。
      // スクロールは scrollable 祖先（.akapen-pane-body）まで遡って調整される
      workingSource.view.dispatch({
        effects: CmEditorView.scrollIntoView(target.pos, { y: "start" }),
      });
    }
  }

  async function destroyEditors(): Promise<void> {
    // G5: 整列デコレーションを破棄
    if (alignmentHandle) {
      alignmentHandle.clear();
      alignmentHandle = null;
    }
    if (alignDebounceTimer !== null) {
      clearTimeout(alignDebounceTimer);
      alignDebounceTimer = null;
    }
    const working = workingWysiwyg;
    workingWysiwyg = null;
    const base = baseWysiwyg;
    baseWysiwyg = null;
    workingSource?.destroy();
    workingSource = null;
    baseSource?.destroy();
    baseSource = null;
    if (working) await working.destroy();
    if (base) await base.destroy();
    for (const el of [
      basePreviewEl,
      baseSourceEl,
      workingPreviewEl,
      workingSourceEl,
    ]) {
      el.innerHTML = "";
    }
  }

  function applyViewMode(mode: ViewMode): void {
    state.viewMode = mode;
    // plan18 T18: 旧 fold bracket reset は撤去（fold 配線そのものが廃止＝ workingWysiwyg.resetFold は無い）。
    const preview = mode === "preview";
    basePreviewEl.classList.toggle("is-hidden", !preview);
    workingPreviewEl.classList.toggle("is-hidden", !preview);
    baseSourceEl.classList.toggle("is-hidden", preview);
    workingSourceEl.classList.toggle("is-hidden", preview);
    toolbar.setViewMode(mode);
    popover.refresh();
    marginNotes.setVisible(preview);
    // plan20 T14: source モードでのみコメント popup を有効化（preview の marginNotes と排他）。
    sourceCommentPopup.setEnabled(!preview);
    paneSync.setPreviewVisible(preview); // F2: preview でスペーサー再計算・source では外す
    // G5: source 表示時に行整列を初期計算、preview 時はクリア
    if (!preview) {
      scheduleAlignment();
    } else if (alignmentHandle) {
      alignmentHandle.clear();
    }
    // G4: モード切替後に TOC の見出し一覧を更新
    refreshOutline();
    refreshUndoRedoState();
  }

  /**
   * エディター一式のマウント（読込みフローの実体・plan18 T15.5b で Operations List ベースに刷新）。
   *
   * - restore あり（rebase なし）：autosave 内の base スナップショット基準で再開。
   *   `state.baseRaw = restore.baseRaw` を据え、`operationStore.restore({ operations, redoStack })`
   *   で operation 列を載せる。derivedMd は subscribe 経由で自動算出。
   * - restore あり＋rebase：現行 base の生テキストを baseRaw に据え、operations は破棄して
   *   新規開きに倒す（旧 reconcile 載せ替え経路は plan18 で廃止＝design.md §2 OUT・座標契約が
   *   変わるため operations はそのまま使えない）。owner には情報バナーを出す。
   * - restore なし（新規開き）：`state.baseRaw = payload.content`、operations は空。
   *
   * 旧 workingMd / reconcile / repair / blockSafeCritic / fold 経路はすべて廃止。
   */
  async function mountEditors(
    payload: OpenFilePayload,
    restore: AutosaveEntry | null,
    options: { rebase?: boolean; entryExists: boolean },
  ): Promise<void> {
    loadingEditors = true;
    setInsertionOnTypeLoading(true);
    cancelAutosaveTimer();
    autosaveDirty = false;
    try {
      await destroyEditors();
      state.basePath = payload.path;
      state.baseOriginal = payload.content;
      state.baseStat = payload.stat;
      state.globalNote = restore?.globalNote ?? "";
      state.criticHits = findCriticTokens(payload.content);
      state.baseChangedExternally = false;
      toolbar.setGlobalNote(state.globalNote);

      // ガード②: 開封時の衝突記法警告（前のファイルのバナー/完了パネルはリセット）
      banners.clear();
      completionPanel.hide();
      if (state.criticHits.length > 0)
        banners.showCriticConflict(state.criticHits.length);

      // ---- baseRaw を据える ----
      // v5 では PM doc が真実源。baseRaw はファイルの元内容をそのまま保持（critic 記法含む）。
      state.baseRaw = payload.content;
      previewMarkdownFormattingDirty = false;
      if (restore && options.rebase) {
        banners.showWarning(
          "前回の作業（添削履歴）は載せ替えできなかったため、現行ファイルを新規に開きました（自動保存は残しています）。",
        );
        state.globalNote = "";
        toolbar.setGlobalNote("");
      }

      refreshDerived(state);

      // ---- エディター実体の生成 ----
      // plan30 Phase 1: 右ペイン WYSIWYG は元ファイル内容を直接表示。
      // Milkdown の critic parser が {--…--} 等を PM marks に変換する。
      workingWysiwyg = await createWysiwygEditor({
        root: workingPreviewEl,
        defaultValue: payload.content,
        // K3.5 段階1（plan6）: 破壊ジェスチャ→ operations.append（gesture.ts で operationStore へ）。
        gesture: true,
        // K3.5 段階3（plan8）: 整形効果表示は作業ペインの preview だけに乗せる。
        formatDisplay: true,
        shortcutHandler: handleShortcutKey,
        // plan18 T15.5b: PM 編集の UI 追従のみ（state は subscribe 経由で更新済み）。
        //   旧 fold（getWorkingMd/setWorkingMd）配線は廃止＝operations が単一真実源。
        //   fold オプション自体を渡さない＝foldBracketPlugin は組み込まれない（plan19 で必要なら再設計）。
        onMarkdownUpdated: () => {
          if (state.viewMode !== "preview" || loadingEditors) return;
          if (!sourceRoundTripInProgress) syncOrMergeAnnotationsFromPm();
          refreshOutline(); // F5: 編集で見出し一覧を追従
          refreshUndoRedoState();
          paneSync.refreshDebounced(); // F2: 編集で右の高さが動く→スペーサー再計算
        },
        // K3.5 段階2（plan7）: 記法文字ガードの通知配線。
        onNotationBlocked: (text) => updateStatusBar(text),
        // M-6（段階5）: 全 noop 上書き時の UI トースト通知。
        onNoopOverwrite: () => updateNoopStatusBar(),
        // plan18 T16: コメント範囲含む削除ブロック時の 3 秒通知。
        onCommentDeleteBlocked: () => updateCommentDeleteStatusBar(),
        // S6-9: editor 初期化中フラグ。loadingEditors=true の間は gesture の onNoopOverwrite を
        //   発火しない（マウント中の spurious toast 防止）。
        loadingEditors: () => loadingEditors,
      });

      // Phase 1 migration: workingWysiwyg 初期化直後の PM doc を basePmDoc として保持。
      basePmDoc = workingWysiwyg.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        return view.state.doc;
      });

      // Phase 2: AnnotationStore の復元。autosave に annotations があればそちらを優先。
      // 新規ファイル（annotations なし）の場合は空 store で開始し、
      // 最初の preview 編集で onMarkdownUpdated → syncAnnotationsFromPm が populate する。
      // mount 中に getMarkdown() を呼ばない（CM6 scroll metrics への干渉防止）。
      annotationStore.clear();
      if (restore?.annotations && restore.annotations.length > 0) {
        annotationStore.restore(restore.annotations);
      }
      updateDerivedMdFromAnnotations(payload.content);

      // 左ペイン＝ベース（読み取り専用・baseOriginal を表示）
      baseWysiwyg = await createWysiwygEditor({
        root: basePreviewEl,
        defaultValue: payload.content,
        readOnly: true,
      });
      baseSource = createSourceEditor({
        parent: baseSourceEl,
        doc: payload.content,
        readOnly: true,
        alignmentExtension: alignmentExt.baseExtension, // G5
      });

      // 右ペイン原文（編集可・削除マーク内編集ガードつき）。
      // plan18 T15.5b: source モードでは acceptAllForDisplay(derivedMd) を表示。
      //   編集差分は toggleViewMode で source-edit-bridge に渡って operations 化される。
      //   ここでは onDocChanged で「ペイン同期 / 見出し / 行整列」のみ追従させ、state.derivedMd
      //   そのものは触らない（toggleViewMode が source→preview で差分を取り込む契約）。
      const initialSourceText = state.derivedMd;
      workingSource = createSourceEditor({
        parent: workingSourceEl,
        doc: initialSourceText,
        alignmentExtension: alignmentExt.workingExtension, // G5
        shortcutExtension: createCodeMirrorShortcutExtension(),
        onCommentDeleteBlocked: () => updateCommentDeleteStatusBar(),
        onDocChanged: () => {
          if (state.viewMode === "source" && !loadingEditors) {
            onEdited();
            refreshOutline(); // F5: 編集で見出し一覧を追従
            paneSync.refreshDebounced(); // source 見出し同期のキャッシュも追従
            refreshUndoRedoState();
            scheduleAlignment(); // G5: 編集で行整列を追従
          }
        },
      });

      // G5: エディターが揃ったら handle を接続
      alignmentHandle = alignmentExt.connect(
        baseSource.view,
        workingSource.view,
      );

      document.title = `${baseNameOf(payload.path)} — AkaPen`;
      emptyEl.classList.add("is-hidden");
      workspaceEl.classList.remove("is-hidden");
      toolbar.setFileLoaded(true);
      applyViewMode("preview");
      refreshOutline(); // F5: 読込んだ文書から見出し一覧を生成
      autosaveExists = options.entryExists;
    } catch (err) {
      // S7-8: HIGH-1 deep clean。catch 経路で部分マウントされた editor ハンドルを null リセット。
      // M-3: state.basePath も null リセット（editor=null・basePath=非null の不整合を防ぐ）。
      workingWysiwyg = null;
      workingSource = null;
      state.basePath = null;
      void bridge.showError({
        message: "ファイルを開く際に予期しないエラーが発生しました",
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      queueMicrotask(() => {
        loadingEditors = false;
        setInsertionOnTypeLoading(false);
      });
    }
  }

  /**
   * 読込みフロー（「開く」/D&D/onOpenFile/再開リストの合流点）＝Task 7 再開導線:
   * (a) 該当 autosave があり進捗があれば confirm「前回の続きから再開しますか？」
   * (b) ディスクの base が autosave の baseStat と異なれば3択
   *     （スナップショットのまま続行／現行 base に載せ替え／破棄）
   */
  async function openFile(payload: OpenFilePayload): Promise<void> {
    // autosave の read 失敗を無言で吸収しない: ENOENT は main 側で entry:null（=なし）、
    // 破損・その他のエラーは新規開きに落とした上で警告バナーで伝える
    let entry: AutosaveEntry | null = null;
    let autosaveReadError: string | null = null;
    try {
      const read = await bridge.autosave.read(payload.path);
      if (read.status === "ok") {
        entry = read.entry;
      } else {
        autosaveReadError = read.message;
      }
    } catch (error) {
      autosaveReadError =
        error instanceof Error ? error.message : String(error);
    }

    // plan21 commit9 (HLD v4 §7 沈黙修復禁止のバグ修正):
    //   mountEditors 冒頭の banners.clear() が showRepairNotice / showWarning を消すため、
    //   整合チェック結果の通知は **mountEditors 呼び出し後**まで deferred して必ず表示する。
    //   pendingRepairReason / pendingSevereReason に保持し、各 return path 直前で
    //   showPendingIntegrityBanner() を呼ぶ。
    let pendingRepairReason: string | null = null;
    let pendingRepairActions: string[] = [];
    let pendingSevereReason: string | null = null;
    const showPendingIntegrityBanner = (): void => {
      if (pendingRepairReason !== null) {
        banners.showRepairNotice(
          "保存データを自動で修復して復元しました。",
          pendingRepairActions.length > 0
            ? pendingRepairActions
            : [pendingRepairReason],
        );
      }
      if (pendingSevereReason !== null) {
        banners.showWarning(
          `前回の自動保存は失われました（${pendingSevereReason}）。素のファイルから開きます。`,
        );
      }
    };

    if (entry) {
      if (!Array.isArray(entry.operations)) {
        entry = { ...entry, operations: [] };
      }
      // Phase 4: autosave の baseRaw にネストした CriticMarkup があれば repair 対象
      if (
        entry.baseRaw !== entry.baseOriginal &&
        /\{--\{\+\+[\s\S]*?\+\+\}--\}|\{\+\+\{--[\s\S]*?--\}\+\+\}/.test(
          entry.baseRaw,
        )
      ) {
        pendingRepairReason = "ネストした CriticMarkup を除去";
        pendingRepairActions = ["ネストした CriticMarkup を除去"];
      }
    }

    if (!entry) {
      await mountEditors(payload, null, { entryExists: false });
      if (autosaveReadError) {
        banners.showWarning(`前回の自動保存が読めません: ${autosaveReadError}`);
      }
      showPendingIntegrityBanner();
      return;
    }

    // plan18 T15.5b: 旧 schemaVersion 1 → 2 のアップグレード経路（K3.5 段階4 / S7-1）は廃止。
    //   schemaVersion 1 検出は main 側 (autosave.ts readAutosave) で IntegrityError throw 済み
    //   (design.md §4-4・owner 検証段階・配布前のため移行ロジックは作らない)。
    //   ここに到達する entry は AutosaveEntryV2 のみ。

    // sha256 で比較（mtime/size は readBaseFile が stat 済み＝ここでは内容一致だけ見る）
    if (entry.baseStat.sha256 === payload.stat.sha256) {
      // plan30/v6: 進捗判定は annotations / globalNote から見る。
      // operations は旧形式互換で残るが、現在の赤ペン差分は AnnotationStore が正本。
      const hasProgress =
        entry.operations.length > 0 ||
        entry.globalNote !== "" ||
        (entry.annotations?.length ?? 0) > 0;
      if (!hasProgress) {
        await mountEditors(payload, null, { entryExists: true });
        showPendingIntegrityBanner();
        return;
      }
      // K1: ボタン文言を「自動保存から再開」（既定・index 0）/「新規で再スタート」に変更。
      // cancelId: 0 を明示＝Esc/ダイアログ閉じは「自動保存から再開」に解決される。
      // 「新規で再スタート」（自動保存を使わない）は明示クリックのみ＝黙って失わない。
      // 想定外の返り値（IPC バリデーション失敗等）も安全側＝再開に倒す。
      const resumeChoice: unknown = await bridge.choose({
        message: "前回の続きから再開しますか？",
        detail: `${new Date(entry.savedAt).toLocaleString()} の自動保存があります。`,
        buttons: ["自動保存から再開", "新規で再スタート"],
        cancelId: 0,
      });
      await mountEditors(payload, resumeChoice === 1 ? null : entry, {
        entryExists: true,
      });
      showPendingIntegrityBanner();
      return;
    }

    // base 不一致＝ディスク上の base が保存時と異なる → 3択（計画2 Task 7 Step 2 (b)）
    const choice = await bridge.choose({
      message: "ファイルが前回の作業時から変更されています。どうしますか？",
      detail:
        `${new Date(entry.savedAt).toLocaleString()} の自動保存があります。\n` +
        "「スナップショットのまま続行」＝保存時の内容を基準に再開します。\n" +
        "「現行ファイルに載せ替え」＝今のファイルを基準に作業を作り直します。\n" +
        "「破棄」＝自動保存を消して今のファイルを新規に開きます。",
      buttons: ["スナップショットのまま続行", "現行ファイルに載せ替え", "破棄"],
    });
    if (choice === 0) {
      // 保存時の base スナップショット基準で再開（ディスクの現行 base に依存しない）
      await mountEditors(
        {
          path: entry.basePath,
          content: entry.baseOriginal,
          stat: entry.baseStat,
        },
        entry,
        { entryExists: true },
      );
    } else if (choice === 1) {
      await mountEditors(payload, entry, { rebase: true, entryExists: true });
    } else {
      // 破棄の remove 失敗も黙らせない（残存＝次回も再開の確認が出ることを伝える）
      let removeError: string | null = null;
      try {
        const removed = await bridge.autosave.remove(payload.path);
        if (removed.status === "error") removeError = removed.message;
      } catch (error) {
        removeError = error instanceof Error ? error.message : String(error);
      }
      await mountEditors(payload, null, { entryExists: removeError !== null });
      if (removeError) {
        banners.showWarning(
          `自動保存を破棄できませんでした（次回も再開の確認が出ます）: ${removeError}`,
        );
      }
    }
    showPendingIntegrityBanner();
  }

  async function openViaDialog(): Promise<void> {
    const result = await bridge.openDialog();
    if (result) await openFile(result);
  }

  /**
   * 再開リスト/D&D 共通: パスを main に読ませてから読込みフローへ。
   * allowlist 不合格・fs エラーは {status:'error'} で返る＝showError 表示（throw 系も同様）
   */
  async function openPath(path: string): Promise<void> {
    try {
      const opened = await bridge.readFile(path);
      if (opened.status === "error") {
        void bridge.showError({
          message: "ファイルを開けませんでした",
          detail: opened.message,
        });
        return;
      }
      await openFile({
        path: opened.path,
        content: opened.content,
        stat: opened.stat,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void bridge.showError({
        message: "ファイルを開けませんでした",
        detail: message,
      });
    }
  }

  // --- 空状態の「続きから再開」リスト（Task 7 (c)） ---
  // list の失敗・破損件数を無言で吸収しない（警告バナーで可視化。読めた分は表示する）
  async function refreshResumeList(): Promise<void> {
    let items: Array<{ basePath: string; savedAt: string }> = [];
    try {
      const result = await bridge.autosave.list();
      if (result.status === "ok") {
        items = result.items;
        if (result.corrupted > 0) {
          banners.showWarning(
            `前回の自動保存が読めません: 破損した自動保存が ${result.corrupted} 件あります`,
          );
        }
      } else {
        banners.showWarning(`前回の自動保存が読めません: ${result.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      banners.showWarning(`前回の自動保存が読めません: ${message}`);
    }
    resumeListEl.innerHTML = "";
    if (items.length === 0) return;
    const title = document.createElement("p");
    title.textContent = "続きから再開:";
    resumeListEl.appendChild(title);
    const list = document.createElement("ul");
    list.className = "akapen-resume-list";
    for (const item of items) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "resume-open";
      button.dataset.basePath = item.basePath;
      button.textContent = `${baseNameOf(item.basePath)}（${new Date(item.savedAt).toLocaleString()}）`;
      button.addEventListener("click", () => {
        void openPath(item.basePath);
      });
      li.appendChild(button);
      list.appendChild(li);
    }
    resumeListEl.appendChild(list);
  }
  void refreshResumeList();

  // --- D&D（Task 7）: window への dragover/drop → getPathForFile → readFile ---
  // ドラッグ中のドロップ枠（Task 9・design.md「操作状態」）: dragover が続く間だけ
  // .is-dragging を付ける（dragleave は子要素間で発火が暴れるためタイマー方式）。
  let dragFrameTimer: number | null = null;
  const clearDragFrame = (): void => {
    if (dragFrameTimer !== null) {
      window.clearTimeout(dragFrameTimer);
      dragFrameTimer = null;
    }
    appEl.classList.remove("is-dragging");
  };
  const onDragOver = (event: DragEvent): void => {
    event.preventDefault();
    appEl.classList.add("is-dragging");
    if (dragFrameTimer !== null) window.clearTimeout(dragFrameTimer);
    dragFrameTimer = window.setTimeout(clearDragFrame, 200);
  };
  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    clearDragFrame();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        // preload がパス解決＋allowlist 登録（register-drop）までやってから返す
        const path = await bridge.getPathForFile(file);
        await openPath(path); // 非 .md は main が error を返す → showError 表示
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void bridge.showError({
          message: "ファイルを開けませんでした",
          detail: message,
        });
      }
    })();
  };
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);

  // --- main からの push（開く3経路）＝購読解除関数を保持し destroy で解除 ---
  const unsubscribeOpenFile = bridge.onOpenFile((payload) => {
    void (async () => {
      if (state.basePath && state.basePath !== payload.path) {
        // レビュー作業中に別ファイルが来たら確認（autosave 済みなので破壊なし）
        const ok = await bridge.confirm({
          message: "現在の作業を閉じて開きますか？",
          detail: `${baseNameOf(payload.path)} を開きます。今の作業は自動保存されています。`,
        });
        if (!ok) return;
        // plan19 Phase 5 HIGH-4:
        //   ① fileSwitchToken をインクリメント＝開きっぱなしの handleHeadingCrossedDialog
        //      が確定すべきタイミングで「もう古いクロージャだ」と検知できるようにする
        //      （後段 onAcceptSingle 前の snapshot 比較で showError へ倒す）。
        //   ② flushAutosave を await＝旧実装の `void` キャストは IPC 完了前に openFile
        //      が走るレースを作っていた。autosave-write の IPC を待ってから openFile。
        fileSwitchToken += 1;
        await flushAutosave();
      }
      await openFile(payload);
    })();
  });

  // K8: メニューからのファイル操作（main → renderer push）
  // 既存の openViaDialog / completeReview / saveReviewAs をそのまま呼ぶ。
  // ⌘S は renderer の keydown ハンドラーが処理しているためメニューに accelerator は設定しない
  // ＝二重発火ゼロ（renderer の handleShortcutKey が save コマンドを担う）。
  const unsubscribeMenuOpen = bridge.onMenuOpen(() => {
    void openViaDialog();
  });
  const unsubscribeMenuSave = bridge.onMenuSave(() => {
    void completeReview();
  });
  const unsubscribeMenuSaveAs = bridge.onMenuSaveAs(() => {
    void saveReviewAs();
  });

  // K7: メニューからの文字サイズ操作（delta=0: reset, 1: +5, -1: -5）
  const unsubscribeMenuFontSize = bridge.onMenuFontSize((delta) => {
    applyMenuFontSize(delta);
  });

  // K7: メニューから設定パネルを開く
  const unsubscribeMenuOpenSettings = bridge.onMenuOpenSettings(() => {
    shortcutPanel.open();
  });

  // ガード③: 外部変更警告（赤バナー。閉じても state には残す＝完了パネルにも注記）
  const unsubscribeBaseChanged = bridge.onBaseChanged(({ path }) => {
    if (state.basePath === path) {
      state.baseChangedExternally = true;
      banners.showBaseChanged();
    }
  });

  /**
   * モード切替（plan18 T15.5a で新仕様に書き換え・source-edit-bridge.ts の 4 関数を使う）。
   *
   * 旧実装は reconcile / repairWorkingMd / blockSafeCritic / 忠実性検査の長大ロジック。
   * 新仕様では state は baseRaw + operations + derivedMd の派生型で、
   * モード切替は ①source 編集の差分を operations に取り込む ②表示を流し込む だけ。
   *
   * 4 関数の分解（source-edit-bridge.ts）:
   *   - extractSourceEditDiff()      : CM6 text vs displayedText の差分抽出
   *   - diffToOperations()           : 差分を Operation 列に変換（baseRaw 座標）
   *   - appendOperationsAndRefresh() : OperationStore.append × N + state 同期
   *   - syncEditorsForViewMode()     : 各エディタに新 derivedMd / displayedText を流し込む
   */

  let sourceProjectionOnEntry: SourceProjection | null = null;
  let sourceUsesCurrentMarkdownProjection = false;

  function refreshSourceProjectionOnEntry(): SourceProjection {
    const projection = buildCriticProjection(
      state.baseOriginal,
      annotationStore.getAll(),
    );
    sourceProjectionOnEntry = projection;
    sourceUsesCurrentMarkdownProjection = false;
    return projection;
  }

  function setCurrentMarkdownSourceProjection(md: string): SourceProjection {
    const projection: SourceProjection = {
      md,
      segments:
        md.length > 0
          ? [
              {
                kind: "base",
                sourceFrom: 0,
                sourceTo: md.length,
                baseOffset: 0,
                baseLength: md.length,
              },
            ]
          : [],
    };
    sourceProjectionOnEntry = projection;
    sourceUsesCurrentMarkdownProjection = true;
    return projection;
  }

  function comparableSourceProjection(md: string): string {
    return canonicalizeBrLines(md).trimEnd().replace(/\n{2,}/g, "\n");
  }

  function escapeCriticOpenersForPreview(md: string): string {
    return md.replace(/\{(?=(--|\+\+|==|>>))/g, "\\{");
  }

  function setWorkingMarkdownWithFallback(md: string): string {
    if (!workingWysiwyg) return md;
    const pmMd = toPmSafeCriticMarkdown(md);
    try {
      workingWysiwyg.setMarkdown(canonicalizeBrLines(pmMd));
      return md;
    } catch (error) {
      const sanitized = sanitizeEmptyCriticMarkup(md);
      if (sanitized !== md) {
        try {
          workingWysiwyg.setMarkdown(
            canonicalizeBrLines(toPmSafeCriticMarkdown(sanitized)),
          );
          return sanitized;
        } catch {
          // Fall through to literal fallback below.
        }
      }
      const literal = escapeCriticOpenersForPreview(sanitized);
      if (literal !== sanitized) {
        workingWysiwyg.setMarkdown(canonicalizeBrLines(literal));
        return literal;
      }
      throw error;
    }
  }

  function setWorkingMarkdownPreservingAnnotations(md: string): string {
    preserveAnnotationsOnNextPmSync = true;
    try {
      return setWorkingMarkdownWithFallback(md);
    } catch (error) {
      preserveAnnotationsOnNextPmSync = false;
      throw error;
    }
  }

  function commitSourceEditsFromEditor(): void {
    if (!workingWysiwyg || !workingSource || !sourceProjectionOnEntry) return;
    const currentSource = workingSource.getText();
    if (currentSource === sourceProjectionOnEntry.md) return;

    if (sourceUsesCurrentMarkdownProjection) {
      const committed = commitSourceEdits({
        currentSource,
        entryProjection: sourceProjectionOnEntry,
        existingAnnotations: [],
      });
      const nextProjectionMd = buildCriticMarkup(
        sourceProjectionOnEntry.md,
        committed,
      );
      if (
        sourceEditHasContentDeletion(sourceProjectionOnEntry.md, currentSource) &&
        !committed.some((annotation) => annotation.type === "deletion")
      ) {
        throw new Error(
          "削除した本文を赤取り消し線として保持できませんでした。変更は反映していません。",
        );
      }
      const nextMd = setWorkingMarkdownPreservingAnnotations(nextProjectionMd);
      state.derivedMd = nextMd;
      setCurrentMarkdownSourceProjection(nextMd);
      if (state.viewMode === "source") {
        workingSource.setText(nextMd);
        const baseText = baseSource ? baseSource.getText() : state.baseRaw;
        paneSync.setSourceTexts(baseText, nextMd);
      }
      return;
    }

    const committed = commitSourceEdits({
      currentSource,
      entryProjection: sourceProjectionOnEntry,
      existingAnnotations: annotationStore.snapshot(),
    });
    annotationStore.restore(committed);

    const nextProjection = refreshSourceProjectionOnEntry();
    const nextMd = setWorkingMarkdownPreservingAnnotations(nextProjection.md);
    state.derivedMd = nextMd;
    if (state.viewMode === "source") {
      workingSource.setText(nextMd);
      const baseText = baseSource ? baseSource.getText() : state.baseRaw;
      paneSync.setSourceTexts(baseText, nextMd);
    }
  }

  function resetSourceEditorToProjectionOnFailure(): void {
    if (!workingSource || !sourceProjectionOnEntry) return;
    workingSource.setText(sourceProjectionOnEntry.md);
    const baseText = baseSource ? baseSource.getText() : state.baseRaw;
    paneSync.setSourceTexts(baseText, sourceProjectionOnEntry.md);
  }

  function applySourceCommentFromSelection(instruction: string): boolean {
    if (!workingWysiwyg || !workingSource || instruction.length === 0) {
      return false;
    }
    const selection = workingSource.view.state.selection.main;
    if (selection.empty) return false;

    let from = selection.from;
    let to = selection.to;
    let projection = sourceProjectionOnEntry ?? refreshSourceProjectionOnEntry();
    const selectedText = workingSource.getText().slice(from, to);
    if (selectedText.length === 0) return false;

    if (workingSource.getText() !== projection.md) {
      commitSourceEditsFromEditor();
      projection = sourceProjectionOnEntry ?? refreshSourceProjectionOnEntry();
      const near = Math.max(0, from - 80);
      const foundNear = projection.md.indexOf(selectedText, near);
      const found = foundNear >= 0 ? foundNear : projection.md.indexOf(selectedText);
      if (found < 0) return false;
      from = found;
      to = found + selectedText.length;
    }

    const baseFrom = mapSourcePosToBaseOffset(projection, from);
    const baseTo = mapSourcePosToBaseOffset(projection, to);
    if (baseTo <= baseFrom) return false;
    const quote = state.baseOriginal.slice(baseFrom, baseTo);
    if (quote.length === 0) return false;

    const annotation: CommentAnnotation = {
      id: generateAnnotationId(),
      type: "comment",
      anchor: {
        baseOffset: baseFrom,
        baseLength: quote.length,
        quote,
      },
      quotedText: quote,
      instruction,
      createdAt: Date.now(),
    };
    annotationStore.add(annotation);

    const nextProjection = refreshSourceProjectionOnEntry();
    const nextMd = setWorkingMarkdownWithFallback(nextProjection.md);
    state.derivedMd = nextMd;
    workingSource.setText(nextMd);
    const baseText = baseSource ? baseSource.getText() : state.baseRaw;
    paneSync.setSourceTexts(baseText, nextMd);
    return true;
  }

  function toggleViewMode(): void {
    if (!workingWysiwyg || !workingSource) return;
    const nextMode: ViewMode =
      state.viewMode === "preview" ? "source" : "preview";

    if (state.viewMode === "source") {
      try {
        sourceRoundTripInProgress = true;
        commitSourceEditsFromEditor();
      } catch (error) {
        resetSourceEditorToProjectionOnFailure();
        void bridge.showError({
          message: "原文モードの変更をプレビューに反映できませんでした。",
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      } finally {
        sourceRoundTripInProgress = false;
      }
    }

    void flushAutosave();
    applyViewMode(nextMode);

    if (nextMode === "source") {
      // 切替前に AnnotationStore を PM doc とマージ（非同期 listener の遅延対策）。
      // `---` など PM が削除 mark として再表現できない構造行は、全置換 sync だと
      // source 削除済みの注釈が落ち、コード表示に戻した時だけ復活してしまう。
      // 通常Markdown整形（H1/H2/H3・太字・箇条書き）は annotation ではないため、
      // 注釈だけから再投影した文字列と差がある場合は現在の PM markdown を source 表示に使う。
      const currentMarkdown = canonicalizeBrLines(workingWysiwyg.getMarkdown());
      mergeAnnotationsFromPm();
      preserveAnnotationsOnNextPmSync = false;
      const annotationProjection = buildCriticProjection(
        state.baseOriginal,
        annotationStore.getAll(),
      );
      const projection =
        !previewMarkdownFormattingDirty ||
        comparableSourceProjection(currentMarkdown) ===
          comparableSourceProjection(annotationProjection.md)
          ? refreshSourceProjectionOnEntry()
          : setCurrentMarkdownSourceProjection(currentMarkdown);
      workingSource.setText(projection.md);

      const baseText = baseSource ? baseSource.getText() : state.baseRaw;
      paneSync.setSourceTexts(baseText, projection.md);
      paneSync.setSourceViews(
        baseSource ? baseSource.view : null,
        workingSource ? workingSource.view : null,
      );
    } else {
      paneSync.setSourceViews(null, null);
    }

    if (nextMode === "source") scheduleAlignment();
    refreshOutline();
    refreshUndoRedoState();
  }

  /**
   * 保存共通フロー（G6: completeReview / saveReviewAs で共有・plan18 T15.5b で Operations List 化）:
   * 1. 現モードが source なら source の編集差分を operations に取り込む（toggleViewMode と同型）。
   * 2. 即時 autosave
   * 3. buildReviewContent（baseRaw + operations → assembleReviewFile が operationsToCritic で書き出し）
   * 4. ガード①: accept 後本文が空 → confirm（No で中断）
   * 5. write（throw/{status:'error'} とも showError で中断・cancelled は何もしない）
   * 6. saved → 完了パネル＋autosave 削除
   */
  async function doSave(saveMode: "default" | "saveAs"): Promise<void> {
    if (!state.basePath || !workingWysiwyg || !workingSource) return;
    if (state.viewMode === "source") {
      const currentSource = workingSource.getText();
      // C20: source テキストに CriticMarkup デリミタ断片がないか先行チェック。
      // AnnotationStore 処理がデリミタを正規化してしまう前にガード。
      const sourceStripped = currentSource
        .replace(/\{\+\+[\s\S]*?\+\+\}/g, "")
        .replace(/\{--[\s\S]*?--\}/g, "")
        .replace(/\{==[\s\S]*?==\}/g, "")
        .replace(/\{>>[\s\S]*?<<\}/g, "");
      if (hasCriticDelimiter(sourceStripped)) {
        void bridge.showError({
          message: "レビューを書き出せませんでした",
          detail:
            "本文に CriticMarkup 記法と衝突する文字列（++} や --} など）が含まれているため整合性を保てません。",
        });
        return;
      }
      if (sourceProjectionOnEntry !== null) {
        commitSourceEditsFromEditor();
      }
    }
    // plan19 Phase 4.5: insert operation の payload が critic デリミタ
    //   ({++, ++}, {--, --}, {==, ==}, {>>, <<}) を含んでいたら整合性違反として
    //   showError＝write しない（C20 IntegrityError 復元）。
    //   旧 reconcile 経路は plan18 で diffToOperations に置き換わったため、検査も
    //   doSave 直前に移す。source 経路だけでなく typing 経路でも有効（appendOperation
    //   側でガードしてもよいが、保存直前の最終ゲートが安全網として機能する）。
    // plan30 Phase 6: PM doc の markdown に critic デリミタ断片が混入していないかチェック。
    // v4 は operations の payload を検査していたが、v5 では PM doc が真実源。
    // ただし {++...++} / {--...--} / {==...==}{>>...<<} は正規の CriticMarkup なので除外し、
    // それ以外のデリミタ断片（例: 末尾の `++}` だけ）をエラーにする。
    if (workingWysiwyg) {
      const bodyMd = workingWysiwyg.getMarkdown();
      const stripped = bodyMd
        .replace(/\{\+\+[\s\S]*?\+\+\}/g, "")
        .replace(/\{--[\s\S]*?--\}/g, "")
        .replace(/\{==[\s\S]*?==\}/g, "")
        .replace(/\{>>[\s\S]*?<<\}/g, "");
      if (hasCriticDelimiter(stripped)) {
        void bridge.showError({
          message: "レビューを書き出せませんでした",
          detail:
            "本文に CriticMarkup 記法と衝突する文字列（++} や --} など）が含まれているため整合性を保てません。",
        });
        return;
      }
    }
    await writeAutosaveNow(); // 失敗は内部でバナー表示（添削＝完了フローは続行可）

    let built: { content: string; acceptedBodyIsEmpty: boolean };
    try {
      // Phase 3: AnnotationStore 優先で CriticMarkup を生成。
      // annotations がある場合は base + annotations → CriticMarkup。
      // ない場合は PM doc の getMarkdown() にフォールバック。
      const pmBody = workingWysiwyg
        ? state.derivedMd || workingWysiwyg.getMarkdown()
        : state.baseOriginal;
      built = buildReviewContent({
        baseOriginal: state.baseOriginal,
        bodyMd: pmBody,
        globalNote: state.globalNote,
        baseFileName: baseNameOf(state.basePath),
        reviewedAt: localReviewDate(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void bridge.showError({
        message: "レビューを書き出せませんでした",
        detail: `本文に CriticMarkup 記法と衝突する文字列（++} や --} など）が含まれている可能性があります。整合性を保てないため保存していません。\n${message}`,
      });
      return;
    }

    // ガード①: 全提案採用で本文が空になる完了の確認
    if (built.acceptedBodyIsEmpty) {
      const ok = await bridge.confirm({
        message: "全提案を採用すると本文が空になります。このまま完了しますか？",
      });
      if (!ok) return;
    }

    let result:
      | { status: "saved"; path: string }
      | { status: "cancelled" }
      | { status: "error"; message: string };
    try {
      if (saveMode === "saveAs") {
        result = await bridge.saveReviewAs({ content: built.content });
      } else {
        result = await bridge.writeReview({
          basePath: state.basePath,
          content: built.content,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void bridge.showError({
        message: "レビューを書き出せませんでした",
        detail: message,
      });
      return;
    }
    if (result.status === "cancelled") return;
    if (result.status === "error") {
      void bridge.showError({
        message: "レビューを書き出せませんでした",
        detail: result.message,
      });
      return;
    }

    completionPanel.show({
      savedPath: result.path,
      baseChangedExternally: state.baseChangedExternally,
    });
    let removeError: string | null = null;
    try {
      const removed = await bridge.autosave.remove(state.basePath);
      if (removed.status === "error") removeError = removed.message;
    } catch (error) {
      removeError = error instanceof Error ? error.message : String(error);
    }
    if (removeError) {
      banners.showWarning(
        `自動保存の削除に失敗しました（自動保存が残っています）: ${removeError}`,
      );
    }
    autosaveExists = removeError !== null;
    autosaveDirty = false;
  }

  async function completeReview(): Promise<void> {
    return doSave("default");
  }

  async function saveReviewAs(): Promise<void> {
    return doSave("saveAs");
  }

  return {
    openFile,
    toggleViewMode,
    completeReview,
    saveReviewAs,
    getState: () => state,
    getWorkingWysiwyg: () => workingWysiwyg,
    getWorkingSource: () => workingSource,
    getBaseSource: () => baseSource,
    getAnnotationsForTest: () => annotationStore.snapshot(),
    // S6-9: e2e 検証用 loadingEditors 強制設定（harness 専用・app 内部では使わない）
    setLoadingEditors: (v: boolean) => {
      loadingEditors = v;
    },
    // T22 e2e harness 専用: CommandContext を組み立てて返す（harness から commands.ts を直接呼ぶ用）
    getCommandContext: (editor) => buildCommandContext(editor),
    showRepairNoticeForTest: (message, actions) => {
      banners.showRepairNotice(message, actions);
    },
    destroy: async () => {
      cancelAutosaveTimer();
      // statusbar 3秒タイマー（U5 通知）が destroy 後に発火して detached DOM へ書き込まないよう解除
      // （独立レビュー指摘 2026-06-13・autosaveTimer と同パターン）
      if (statusbarTimer !== null) {
        window.clearTimeout(statusbarTimer);
        statusbarTimer = null;
      }
      clearDragFrame();
      unsubscribeOpenFile();
      unsubscribeBaseChanged();
      unsubscribeMenuOpen();
      unsubscribeMenuSave();
      unsubscribeMenuSaveAs();
      unsubscribeMenuFontSize();
      unsubscribeMenuOpenSettings();
      document.removeEventListener("keydown", onDocumentShortcutKey, true);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      paneSync.destroy();
      marginNotes.destroy();
      // plan20 T14: source モード用 popup も解除（preview 用 popup は marginNotes.destroy() が担当）
      sourceCommentPopup.destroy();
      popover.destroy();
      shortcutPanel.destroy();
      await destroyEditors();
      appEl.remove();
    },
  };
}
