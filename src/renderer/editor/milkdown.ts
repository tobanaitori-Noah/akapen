/**
 * WYSIWYG エディター生成ファクトリ（Milkdown）。
 *
 * 実機確認済みの最小構成（docs/spike-notes.md）＝Editor.make()＋rootCtx＋
 * defaultValueCtx＋commonmark＋listener＋prosemirror.css、
 * md 取り出しは serializerCtx＋editorViewCtx。
 * スパイク未検証 API（editorViewOptionsCtx.editable / parserCtx / tr.replace＋Slice）は
 * 公式 doc・installed 実物で確認済み＝docs/implementation-notes.md に記録。
 *
 * plan18 T13.5 （2026-06-17）: Milkdown / ProseMirror 内蔵 history プラグインは無効化。
 * Cmd+Z / Cmd+Shift+Z は OperationStore.undo / redo（app.ts 配線）に統一する。
 * handle.undo / redo / undoDepth / redoDepth / clearHistory は後方互換のため残すが
 * 全て no-op（権威は OperationStore＝自前 stack が真実源）。
 */
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
// plan30 Phase 5: prosemirror-history（PM 標準）に戻す。v4 の OperationStore.undo/redo は廃止。
import { history } from "@milkdown/kit/plugin/history";
import {
  undo as pmUndo,
  redo as pmRedo,
  undoDepth as pmUndoDepth,
  redoDepth as pmRedoDepth,
} from "@milkdown/kit/prose/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { Slice } from "@milkdown/kit/prose/model";
import {
  liftListItem as pmLiftListItem,
  splitListItem as pmSplitListItem,
} from "@milkdown/kit/prose/schema-list";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "./critic.css";
import {
  commentSchema,
  criticRemark,
  deletionSchema,
  highlightSchema,
  insertionSchema,
} from "./critic";
import { criticRemarkSyntax } from "./critic-remark-syntax";
import { formatDisplay, formatDisplayAtomicRanges } from "./format-display";
import { insertionOnType } from "./insertion-on-type";
import { canonicalizeBrLines } from "./md-canonicalize";
import { createGesturePlugin } from "./gesture";
import type { GestureMetrics } from "./gesture";
import { changeSetPlugin, insertionDecoPlugin } from "./changeset-tracker";

/** 表示切替の自前全置換 tr の印（insertion-on-type の除外用） */
export const AKAPEN_SKIP_INSERTION_META = "akapen-skip-insertion";

export interface WysiwygEditorOptions {
  /** マウント先（要素 or セレクタ） */
  root: HTMLElement | string;
  /** 初期 markdown（CriticMarkup 入り） */
  defaultValue: string;
  /** 読み取り専用（左ペイン＝ベース表示用） */
  readOnly?: boolean;
  /**
   * md が変わるたびに呼ばれる（描画/UI 更新専用＝plan3b §2）。
   * ⚠️ 段階2+3 では state.workingMd を書く役割は持たない（fold が真実源を更新する）。
   * UI 追従（見出し一覧・undo/redo 状態・ペイン同期）にのみ使う。
   */
  onMarkdownUpdated?: (md: string) => void;
  /**
   * K3.5 段階1（plan6）: 破壊ジェスチャの即時取り消し線プラグインを組み込む。
   * 編集可能な作業ペイン（右）でのみ true にする＝readOnly のベースペインでは無効
   * （消す系操作を握る相手が居ない・false 既定）。
   */
  gesture?: boolean;
  /**
   * K3.5 段階2（plan7）: critic デリミタ入力を弾いた時に呼ぶ callback（U5 通知の素通し）。
   * gesture=true の時のみ有効。省略可能（既定 undefined）。
   */
  onNotationBlocked?: (text: string) => void;
  /**
   * K3.5 段階4（plan9）: 段落結合即時化のフック（gesture=true の時のみ有効）。
   * gesture が「ブロック頭 Backspace / ブロック末 Delete」を観測したら呼ぶ。
   * app 側で workingMd 上の `\n\n` を `{--\n\n--}` で囲む（PM doc は不変＝DOC-INVARIANT 維持）。
   * 戻り値の意味は gesture.ts の GestureHooks.onParagraphJoin の docstring を参照。
   */
  onParagraphJoin?: (
    direction: "backspace" | "delete",
  ) => "joined" | "noop" | "reject" | "reject-pm";
  /**
   * M-6（段階5）: 全 noop 上書き時の UI トースト通知（gesture=true の時のみ有効）。
   * 詳細は gesture.ts の GestureHooks.onNoopOverwrite を参照。
   */
  onNoopOverwrite?: () => void;
  /**
   * plan18 T16: コメント範囲含む削除をブロックした時の UI トースト通知（gesture=true の時のみ有効）。
   * 詳細は gesture.ts の GestureHooks.onCommentDeleteBlocked を参照。
   */
  onCommentDeleteBlocked?: () => void;
  /**
   * S6-9（段階6）: editor 初期化中フラグを返す関数（gesture=true の時のみ有効）。
   * true の間は onNoopOverwrite を発火しない（マウント中のスプリアス toast 防止）。
   * 詳細は gesture.ts の GestureHooks.loadingEditors を参照。
   */
  loadingEditors?: () => boolean;
  /**
   * K3.5 段階3（plan8）: ビュワー（preview）で整形効果を表示する S1 機構を組み込む。
   *   - criticRemarkSyntax: critic 4記法を micromark の atomic トークンとして食う（emphasis 先食い回避）
   *   - formatDisplay: 整形記号 `**`/`## `/`- ` を decoration で隠し、対象本文に効果クラスを被せる
   *   - formatDisplayAtomicRanges: 隠し区間にキャレットを入れないスナップ（doc 不変・selection のみ更新）
   * 既定 false。working preview だけ true、base preview/source は false（plan8 §4 配線）。
   */
  formatDisplay?: boolean;
  /** J9: mutable registry を読む dynamic shortcut handler */
  shortcutHandler?: (event: KeyboardEvent) => boolean;
}

export interface WysiwygEditorHandle {
  editor: Editor;
  /** 現在の doc を md（CriticMarkup 入り）として取り出す */
  getMarkdown(): string;
  /** md を丸ごと流し込む（自前全置換＋akapen-skip-insertion meta） */
  setMarkdown(md: string): void;
  /**
   * Phase 1 migration: baseDoc（source モード進入時の PM doc）との差分を取り、
   * 追記された区間に criticInsertion mark を付与する。
   * setMarkdown() の直後に呼ぶ（source→preview 切替・doSave 経路）。
   * addToHistory: false で付与するため undo 不可（検出状態の反映）。
   */
  applyInsertionMarks(baseDoc: import("prosemirror-model").Node): void;
  undo(): boolean;
  redo(): boolean;
  undoDepth(): number;
  redoDepth(): number;
  /** ProseMirror history の内部状態だけを空にする（doc/plugins は保持） */
  clearHistory(): void;
  /** gesture 配線時のメトリクス（条件①no-op 発火・取り消し線正規化数の機械 assert 用・無ければ null） */
  gestureMetrics: GestureMetrics | null;
  destroy(): Promise<void>;
}

/**
 * テキストオフセット（0-indexed・textContent ベース）を PM doc の絶対位置に変換する。
 * doc の textContent のうち先頭から textOffset 文字目に対応する PM 位置を返す。
 * オフセットが doc 全体のテキスト長を超える場合は doc.content.size を返す。
 */
function textOffsetToPmPos(
  doc: import("prosemirror-model").Node,
  textOffset: number,
): number {
  let remaining = textOffset;
  let result = 0;

  function walk(node: import("prosemirror-model").Node, pos: number): boolean {
    if (node.isText) {
      const len = node.text!.length;
      if (remaining <= len) {
        result = pos + remaining;
        return true;
      }
      remaining -= len;
      return false;
    }
    if (node.isLeaf) return false;

    const childPos = pos + 1; // skip open token
    let cp = childPos;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (walk(child, cp)) return true;
      cp += child.nodeSize;
    }
    return false;
  }

  let childPos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (walk(child, childPos)) return result;
    childPos += child.nodeSize;
  }
  return doc.content.size;
}

function listItemDepth(view: EditorView): number | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "list_item") return depth;
  }
  return null;
}

function handleListEnter(view: EditorView): boolean {
  const listItemType = view.state.schema.nodes["list_item"];
  if (!listItemType) return false;
  const depth = listItemDepth(view);
  if (depth === null) return false;

  const item = view.state.selection.$from.node(depth);
  const command =
    item.textContent.trim().length === 0
      ? pmLiftListItem(listItemType)
      : pmSplitListItem(listItemType);
  return command(view.state, view.dispatch);
}

function insertHardBreak(view: EditorView): boolean {
  const hardBreakType =
    view.state.schema.nodes["hardbreak"] ?? view.state.schema.nodes["hard_break"];
  if (!hardBreakType) return false;
  const marks = view.state.storedMarks ?? view.state.selection.$from.marks();
  let tr = view.state.tr
    .replaceSelectionWith(hardBreakType.create(), true)
    .setMeta(AKAPEN_SKIP_INSERTION_META, true);
  if (marks.length > 0) tr = tr.ensureMarks(marks);
  view.dispatch(tr.scrollIntoView());
  return true;
}

function handleNativeEditingKey(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Enter") return false;
  const handled = event.shiftKey
    ? insertHardBreak(view)
    : handleListEnter(view);
  if (!handled) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export async function createWysiwygEditor(
  options: WysiwygEditorOptions,
): Promise<WysiwygEditorHandle> {
  const {
    root,
    defaultValue,
    readOnly = false,
    onMarkdownUpdated,
    gesture = false,
    onNotationBlocked,
    onParagraphJoin,
    onNoopOverwrite,
    onCommentDeleteBlocked,
    loadingEditors,
    formatDisplay: formatDisplayEnabled = false,
    shortcutHandler,
  } = options;
  // K3.5 段階1（plan6）: 破壊ジェスチャの即時取り消し線プラグイン（作業ペインのみ）。
  // insertion-on-type と同列に .use() する。readOnly ベースペインでは作らない（gesture=false）。
  // K3.5 段階2（plan7）: onNotationBlocked を hooks として素通し。
  // K3.5 段階4（plan9）: onParagraphJoin を hooks として素通し（段落結合即時化）。
  // M-6（段階5）: onNoopOverwrite を hooks として素通し（全 noop 上書き時の UI トースト）。
  // plan18 T16: onCommentDeleteBlocked を hooks として素通し（コメント含む削除ブロック通知）。
  const gestureBundle = gesture
    ? createGesturePlugin({
        onNotationBlocked,
        onParagraphJoin,
        onNoopOverwrite,
        onCommentDeleteBlocked,
        loadingEditors,
      })
    : null;
  const shortcutPlugin = $prose(
    () =>
      new Plugin({
        props: {
          handleKeyDown: (view, event) =>
            handleNativeEditingKey(view, event) ||
            (shortcutHandler?.(event) ?? false),
        },
      }),
  );
  // plan18 T18: 旧 foldBracketPlugin / FoldWiring 配線は撤去（権威は OperationStore＝app.ts が所有）。
  let editorChain = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, defaultValue);
      ctx.set(remarkStringifyOptionsCtx, {
        bullet: "-" as const,
        rule: "-" as const,
        listItemIndent: "one" as const,
      });
      // readOnly: 公式 doc のパターン（editable を関数で返す・prev を保つ）
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => !readOnly,
      }));
      if (onMarkdownUpdated) {
        ctx.get(listenerCtx).markdownUpdated((_ctx, md) => {
          // v1.1.2: listener が渡す md にも canonicalize を適用。
          // getMarkdown() と同じ変換を通すことで state.workingMd が常に正規化済みになる。
          onMarkdownUpdated(canonicalizeBrLines(md));
        });
      }
    })
    .use(shortcutPlugin)
    .use(commonmark)
    // plan30 Phase 5: PM 標準 history を有効化（v4 の OperationStore.undo/redo を廃止）。
    .use(history)
    .use(listener)
    // K3.5 段階3（plan8）: critic micromark 構文拡張は criticRemark **より前段** に積む。
    // 理由＝micromark の text construct として `{++…++}` を atomic に食わせ、内側 `**` を
    // emphasis トークナイザに届かせない（emphasis 先食いで `<strong>` 化する罠を回避）。
    .use(criticRemarkSyntax)
    .use(criticRemark)
    .use(deletionSchema)
    .use(insertionSchema)
    .use(commentSchema)
    .use(highlightSchema)
    .use(insertionOnType)
    // plan30 Phase 1: prosemirror-changeset ベースの変更追跡。
    // changeSetPlugin = step maps 蓄積、insertionDecoPlugin = 追記区間の赤字 decoration。
    .use(changeSetPlugin)
    .use(insertionDecoPlugin);
  // gesture は insertion-on-type の後に積む（破壊ジェスチャを握り、insertion-on-type は
  // gesture の置換 tr を除外メタで素通しする＝役割排他・plan6 §2-2）。
  if (gestureBundle) {
    editorChain = editorChain.use(gestureBundle.prose);
  }
  // K3.5 段階3（plan8 §4）: 整形効果表示。decoration プラグインに加え、隠し区間に
  // キャレットを入れないスナップ用の atomicRanges 兄弟プラグインも積む（doc 不変＝
  // DOC-INVARIANT を守るため appendTransaction で **selection のみ**を書き換える）。
  if (formatDisplayEnabled) {
    editorChain = editorChain.use(formatDisplay).use(formatDisplayAtomicRanges);
  }
  const editor = await editorChain.create();

  const getMarkdown = (): string => {
    const raw = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      return ctx.get(serializerCtx)(view.state.doc);
    });
    // v1.1.2: remarkPreserveEmptyLine が空リスト項目を `* <br />` にシリアライズする問題を根治。
    // getMarkdown() 出力で `<br />` を含む空マーカー行を prefix のみに正規化する。
    return canonicalizeBrLines(raw);
  };

  // 表示切替などで md を丸ごと流し込む全置換。
  // Milkdown `replaceAll` macro は meta を付けられない（meta 付与は未検証 API ＝使わない）
  // ため、ProseMirror view.dispatch の自前全置換に `akapen-skip-insertion` meta を付け、
  // insertion-on-type（Task 3）が流し込みを誤マークしないようにする。
  const setMarkdown = (md: string): void => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const doc = ctx.get(parserCtx)(md);
      if (!doc) return;
      const { state } = view;
      const tr = state.tr
        .replace(0, state.doc.content.size, new Slice(doc.content, 0, 0))
        .setMeta(AKAPEN_SKIP_INSERTION_META, true)
        .setMeta("addToHistory", false);
      view.dispatch(tr);
    });
  };

  const withView = <T>(fn: (view: EditorView) => T): T =>
    editor.action((ctx) => fn(ctx.get(editorViewCtx)));
  // withView は setMarkdown 内のディスパッチ以外で使う箇所がなくなるが（plan18 T13.5 で
  // history 公開 API を no-op 化したため）、将来の編集経路追加に備えて残す。
  void withView;

  // Phase 1 migration: baseDoc との差分から追記区間を検出し criticInsertion mark を付与。
  const applyInsertionMarks = (
    baseDoc: import("prosemirror-model").Node,
  ): void => {
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const currentDoc = state.doc;

        const baseText = baseDoc.textContent;
        const currText = currentDoc.textContent;

        if (baseText === currText) return;

        let pre = 0;
        const preMax = Math.min(baseText.length, currText.length);
        while (pre < preMax && baseText[pre] === currText[pre]) pre++;

        let suf = 0;
        const sufMax = Math.min(baseText.length - pre, currText.length - pre);
        while (
          suf < sufMax &&
          baseText[baseText.length - 1 - suf] ===
            currText[currText.length - 1 - suf]
        )
          suf++;

        const newLen = currText.length - pre - suf;
        if (newLen <= 0) return;

        const pmFrom = textOffsetToPmPos(currentDoc, pre);
        const pmTo = textOffsetToPmPos(currentDoc, pre + newLen);
        if (pmFrom >= pmTo) return;

        const markType = state.schema.marks["criticInsertion"];
        if (!markType) return;

        const tr = state.tr
          .addMark(pmFrom, pmTo, markType.create())
          .setMeta("addToHistory", false);
        view.dispatch(tr);
      });
    } catch (e) {
      console.error("applyInsertionMarks failed:", e);
    }
  };

  // plan30 Phase 5: PM 標準 history に委譲。
  const handle: WysiwygEditorHandle = {
    editor,
    getMarkdown,
    setMarkdown,
    applyInsertionMarks,
    undo: () =>
      editor.action((c) =>
        pmUndo(c.get(editorViewCtx).state, c.get(editorViewCtx).dispatch),
      ),
    redo: () =>
      editor.action((c) =>
        pmRedo(c.get(editorViewCtx).state, c.get(editorViewCtx).dispatch),
      ),
    undoDepth: () =>
      editor.action((c) => pmUndoDepth(c.get(editorViewCtx).state)),
    redoDepth: () =>
      editor.action((c) => pmRedoDepth(c.get(editorViewCtx).state)),
    clearHistory: () => {
      /* PM history はエディター再作成でリセットされる */
    },
    gestureMetrics: gestureBundle?.metrics ?? null,
    destroy: async () => {
      await editor.destroy();
    },
  };
  return handle;
}
