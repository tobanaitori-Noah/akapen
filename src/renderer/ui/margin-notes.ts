/**
 * コメント欄外注（HLD §5 の v1 実装＝計画2 Task 9 Step 5・受け入れ C25）。
 *
 * plan15 C-4: 右マージン常時表示を廃止し、comment-popup.ts によるホバー/クリック
 * ポップアップに移行。DOM 描画（layout/MutationObserver/SVG 引き出し線）は停止。
 * createMarginNotes は後方互換のため存続するが、内部で createCommentPopup を
 * 起動してコメント編集機能を提供する（app.ts を変更しない最小差分）。
 *
 * 旧挙動（右マージン欄外注 + 引き出し線 SVG）は本ファイルの history で参照可。
 */
import { createCommentPopup } from './comment-popup';

export interface MarginNotesOptions {
  /** 右ペイン本体（scroll container・position: relative の .akapen-pane-body） */
  paneBody: HTMLElement;
  /** 右ペイン preview のマウント先（load を跨いで存続する [data-editor="working-preview"]） */
  editorRoot: HTMLElement;
  /**
   * plan15 C-3/C-4: 指示文編集確定コールバック。
   * `editComment(editor, newInstruction)` を呼ぶ側（app.ts）が注入する。
   * 未提供の場合はポップアップの編集機能が無効になる（旧動作互換）。
   * H3 改善: commentEl を受け取り、呼び出し側で PM 位置を特定できるようにする。
   */
  onEditComment?(newInstruction: string, commentEl: HTMLElement): void;
  /**
   * plan15 追加修正 A: 「コメント削除」ボタン押下コールバック。
   * `removeCommentMark(editor)` を呼ぶ側（app.ts）が注入する。
   * commentEl = 対象の critic-comment 要素（removeCommentMark で PM 位置を特定する）。
   */
  onRemoveComment?(commentEl: HTMLElement): void;
}

export interface MarginNotesHandle {
  /**
   * plan15 C-4: 右マージン常時表示は廃止。refresh() は後方互換のため存続するが何もしない。
   * @deprecated plan15 C-4 で内部実装を停止。呼び出し元（app.ts）は変更不要。
   */
  refresh(): void;
  /**
   * preview モード on/off。plan15 C-4 では comment-popup の enabled 切替に転用。
   */
  setVisible(visible: boolean): void;
  destroy(): void;
}

function findCommentSpanAfter(root: HTMLElement, target: HTMLElement): HTMLElement | null {
  const findIn = (node: Node): HTMLElement | null => {
    if (!(node instanceof HTMLElement)) return null;
    if (node.matches('span.critic-comment')) return node;
    return node.querySelector<HTMLElement>('span.critic-comment');
  };

  let node: Node | null = target;
  while (node && node !== root) {
    let sibling = node.nextSibling;
    while (sibling) {
      const found = findIn(sibling);
      if (found) return found;
      sibling = sibling.nextSibling;
    }
    node = node.parentNode;
  }
  return null;
}

export function createMarginNotes(options: MarginNotesOptions): MarginNotesHandle {
  const { paneBody, editorRoot, onEditComment, onRemoveComment } = options;

  // plan15 C-4: 右マージン DOM は生成しない（廃止）
  // 代わりに comment-popup を起動してホバー/クリックによるポップアップ表示を提供する

  // onEditComment が未提供の場合も comment-popup を起動する（hover プレビューは常に有効）。
  // 編集確定コールバックは no-op（app.ts を変更しない後方互換）。
  const commentPopup = createCommentPopup({
    paneBody,
    editorRoot,
    targetSelector: 'mark.critic-highlight',
    readInstruction: (target) => {
      const comment = findCommentSpanAfter(editorRoot, target);
      return comment?.textContent ?? '';
    },
    resolveActionTarget: (target) => {
      return findCommentSpanAfter(editorRoot, target) ?? target;
    },
    onEditConfirm: onEditComment ?? ((_newInstruction: string, _commentEl: HTMLElement) => { /* no-op */ }),
    onRemoveComment,
  });

  return {
    refresh(): void {
      // plan15 C-4: 常時表示廃止 → no-op（app.ts を変更しないための後方互換）
    },
    setVisible(next: boolean): void {
      // plan15 C-4: preview モードへの切替を comment-popup の有効/無効に転用
      commentPopup?.setEnabled(next);
      // has-margin-notes クラスは付与しない（右カラムの余白を確保しない）
    },
    destroy(): void {
      commentPopup?.destroy();
    },
  };
}
