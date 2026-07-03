/**
 * コメント編集ポップアップ（plan15 C-3/C-4）。
 *
 * 右ペイン（preview）の `span.critic-comment` 要素に hover/click を監視し、
 * ホバー時はツールチップ風プレビュー（読み取り専用）、クリック時は固定編集モードへ遷移。
 * 編集モード: テキスト入力欄 + Enter 確定 / Esc キャンセル / 外クリック確定。
 *
 * app.ts は触らない制約のため margin-notes.ts が本モジュールを内部で起動する。
 *
 * plan15 C-4: 右マージン常時表示（akapen-margin-notes）廃止と同時に本ポップアップを有効化。
 */
import { getLanguage, onLanguageChange, t } from '../i18n';
import {
  appendTemplateText,
  getCommentTemplateText,
  isCommentTemplateFeatureUnlocked,
  loadCommentTemplates,
  recordCommentTemplateUsage,
  type CommentTemplate,
} from './comment-templates';
import {
  openTemplateSelector,
  TEMPLATE_SELECTOR_CLASS,
  type TemplateSelectorHandle,
} from './template-selector';

export const COMMENT_TEMPLATE_BUTTON_CLASS = 'akapen-comment-popup__template-button';

const POPUP_VIEWPORT_GAP = 12;
const POPUP_OFFSET_Y = 4;
const TEMPLATE_BUTTON_CHEVRON_SVG = `
          <svg class="akapen-template-button__chevron" aria-hidden="true" viewBox="0 0 12 12" focusable="false">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>`;

export function buildCommentPopupHtml(): string {
  return `
    <div class="akapen-comment-popup__preview"></div>
    <div class="akapen-comment-popup__edit" hidden>
      <div class="akapen-comment-popup__input-row">
        <input type="text" class="akapen-comment-popup__input" placeholder="${t('popover.instructionPlaceholder')}" />
        <button type="button" class="${COMMENT_TEMPLATE_BUTTON_CLASS}" data-action="comment-template" aria-label="${t('commentTemplate.buttonTooltip')}" title="${t('commentTemplate.buttonTooltip')}">
          <span class="akapen-template-button__label">${t('commentTemplate.button')}</span>
${TEMPLATE_BUTTON_CHEVRON_SVG}
        </button>
      </div>
      <div class="akapen-comment-popup__actions">
        <button type="button" class="akapen-comment-popup__confirm">${t('popover.confirm')}</button>
        <button type="button" class="akapen-comment-popup__remove">${t('commentPopup.remove')}</button>
      </div>
    </div>
  `;
}

export interface CommentPopupOptions {
  /** ポップアップをマウントする親（position: relative の右ペイン本体） */
  paneBody: HTMLElement;
  /** コメントノードが属するエディタールート（hover/click 監視対象） */
  editorRoot: HTMLElement;
  /**
   * hover/click 検出対象の CSS selector。
   * preview は `mark.critic-highlight`、source は `.akapen-source-comment-highlight` を渡す。
   * 既定値は旧呼び出し互換のため `span.critic-comment`。
   */
  targetSelector?: string;
  /**
   * popup の preview / input 欄に表示するテキストを target 要素から取り出すフック。
   * 既定 = `target.textContent`。
   * preview は隣接する hidden comment span、source は蛍光ペン span の
   * `data-akapen-comment-instruction` 属性に入る＝抽出ロジックを切替える。
   */
  readInstruction?(target: HTMLElement): string;
  /**
   * 編集/削除コールバックに渡す実体要素。
   * preview で target を highlight 側にする場合、PM 位置特定には隣接する
   * `span.critic-comment` が必要になる。
   */
  resolveActionTarget?(target: HTMLElement): HTMLElement;
  /**
   * Enter 確定時に呼ばれる。newInstruction = 入力欄の trim 済みテキスト。
   * 空文字の場合は呼ばれない（キャンセル扱い）。
   * H3 改善: commentEl を渡すことで呼び出し側が PM の posAtDOM で位置を特定できる。
   */
  onEditConfirm(newInstruction: string, commentEl: HTMLElement): void;
  /**
   * 「コメント削除」ボタン押下時に呼ばれる。
   * commentEl = 対象の critic-comment 要素（removeCommentMark で位置特定に使う）。
   */
  onRemoveComment?(commentEl: HTMLElement): void;
}

export interface CommentPopupHandle {
  /** preview モード有効/無効（false で全機能停止・ポップアップも閉じる） */
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export function createCommentPopup(options: CommentPopupOptions): CommentPopupHandle {
  const { paneBody, editorRoot, onEditConfirm } = options;
  const { onRemoveComment } = options;
  // target 要素から instruction を取り出すフックも併せて切替できる。
  // 既定は旧呼び出し互換＝既存呼び出し点は挙動が変わらない。
  const targetSelector = options.targetSelector ?? 'span.critic-comment';
  const readInstruction =
    options.readInstruction ?? ((el: HTMLElement) => el.textContent ?? '');
  const resolveActionTarget =
    options.resolveActionTarget ?? ((el: HTMLElement) => el);

  // --- ポップアップ DOM ---
  const popup = document.createElement('div');
  popup.className = 'akapen-comment-popup';
  popup.setAttribute('role', 'tooltip');
  popup.innerHTML = buildCommentPopupHtml();
  paneBody.appendChild(popup);

  const previewEl = popup.querySelector<HTMLElement>('.akapen-comment-popup__preview')!;
  const editEl = popup.querySelector<HTMLElement>('.akapen-comment-popup__edit')!;
  const inputRowEl = popup.querySelector<HTMLElement>('.akapen-comment-popup__input-row')!;
  const inputEl = popup.querySelector<HTMLInputElement>('.akapen-comment-popup__input')!;
  const templateBtn = popup.querySelector<HTMLButtonElement>(`.${COMMENT_TEMPLATE_BUTTON_CLASS}`)!;
  const confirmBtn = popup.querySelector<HTMLButtonElement>('.akapen-comment-popup__confirm')!;
  const removeBtn = popup.querySelector<HTMLButtonElement>('.akapen-comment-popup__remove')!;
  const unsubscribeLanguage = onLanguageChange(() => {
    inputEl.placeholder = t('popover.instructionPlaceholder');
    templateBtn.querySelector<HTMLElement>('.akapen-template-button__label')!.textContent =
      t('commentTemplate.button');
    templateBtn.setAttribute('aria-label', t('commentTemplate.buttonTooltip'));
    templateBtn.title = t('commentTemplate.buttonTooltip');
    confirmBtn.textContent = t('popover.confirm');
    removeBtn.textContent = t('commentPopup.remove');
  });

  let enabled = false;
  /** 現在 hover 中の comment 要素 */
  let hoveredComment: HTMLElement | null = null;
  /** 編集モードで固定表示中の comment 要素 */
  let lockedComment: HTMLElement | null = null;
  /** hover delay タイマー */
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let templateSelector: TemplateSelectorHandle | null = null;
  let templates: CommentTemplate[] | null = null;
  let templateLoading = false;

  const notifyPremiumRequired = (): void => {
    void window.dispatchEvent(
      new CustomEvent('akapen:premium-required', {
        detail: { feature: 'comment-templates' },
      }),
    );
  };

  const closeTemplateSelector = (): void => {
    templateSelector?.close();
    templateSelector = null;
  };

  const openTemplateSelectorFromButton = async (): Promise<void> => {
    if (templateSelector) {
      closeTemplateSelector();
      inputEl.focus();
      return;
    }
    if (templateLoading) return;
    templateLoading = true;
    templateBtn.disabled = true;
    let unlocked = false;
    try {
      unlocked = await isCommentTemplateFeatureUnlocked();
    } catch {
      unlocked = false;
    }
    if (!unlocked) {
      templateLoading = false;
      templateBtn.disabled = false;
      notifyPremiumRequired();
      return;
    }
    try {
      templates ??= await loadCommentTemplates();
    } catch {
      templates = [];
    } finally {
      templateLoading = false;
      templateBtn.disabled = false;
    }
    if (templateSelector) return;
    clampPopupToViewport();
    templateSelector = openTemplateSelector({
      templates: templates ?? [],
      mount: popup,
      anchor: inputRowEl,
      widthElement: inputRowEl,
      returnFocus: inputEl,
    });
    const selected = await templateSelector.result;
    templateSelector = null;
    if (!popup.isConnected) return;
    if (!selected) {
      inputEl.focus();
      return;
    }
    inputEl.value = appendTemplateText(
      inputEl.value,
      getCommentTemplateText(selected, getLanguage()),
    );
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    void recordCommentTemplateUsage(selected.id)
      .then((updated) => {
        templates = updated;
      })
      .catch(() => undefined);
    inputEl.focus();
  };

  // --- 状態管理 ---

  const hide = (): void => {
    popup.classList.remove('is-open', 'is-edit');
    closeTemplateSelector();
    hoveredComment = null;
    lockedComment = null;
    cpEnterPending = false; // 修正 F 改: ポップアップ閉時にフラグリセット
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const isEditMode = (): boolean => popup.classList.contains('is-edit');

  /**
   * popup を comment 要素の直下に配置する。
   * paneBody コンテンツ座標（スクロール考慮済み）で絶対配置。
   */
  const positionBelow = (comment: HTMLElement): void => {
    const rect = comment.getBoundingClientRect();
    const bodyRect = paneBody.getBoundingClientRect();
    const left = rect.left - bodyRect.left + paneBody.scrollLeft;
    const top = rect.bottom - bodyRect.top + paneBody.scrollTop + POPUP_OFFSET_Y;
    popup.style.left = `${Math.max(0, left)}px`;
    popup.style.top = `${Math.max(0, top)}px`;
  };

  const clampPopupToViewport = (): void => {
    const rect = popup.getBoundingClientRect();
    let nextLeft = Number.parseFloat(popup.style.left) || 0;
    let nextTop = Number.parseFloat(popup.style.top) || 0;
    const viewportRight = window.innerWidth - POPUP_VIEWPORT_GAP;
    const viewportBottom = window.innerHeight - POPUP_VIEWPORT_GAP;
    if (rect.right > viewportRight) nextLeft -= rect.right - viewportRight;
    if (rect.left < POPUP_VIEWPORT_GAP) nextLeft += POPUP_VIEWPORT_GAP - rect.left;
    if (rect.bottom > viewportBottom) nextTop -= rect.bottom - viewportBottom;
    if (rect.top < POPUP_VIEWPORT_GAP) nextTop += POPUP_VIEWPORT_GAP - rect.top;
    popup.style.left = `${Math.max(0, Math.round(nextLeft))}px`;
    popup.style.top = `${Math.max(0, Math.round(nextTop))}px`;
  };

  const showPreview = (comment: HTMLElement): void => {
    if (lockedComment) return; // 編集モード中は hover 無視
    // plan20 T14: source モードでは target 要素自身ではなく data 属性から instruction を取得する。
    //   既定（preview）は textContent＝既存挙動と同じ。
    const text = readInstruction(comment);
    previewEl.textContent = text;
    editEl.hidden = true;
    positionBelow(comment);
    popup.classList.add('is-open');
    popup.classList.remove('is-edit');
    clampPopupToViewport();
    hoveredComment = comment;
  };

  const openEdit = (comment: HTMLElement): void => {
    const text = readInstruction(comment);
    inputEl.value = text;
    previewEl.textContent = text;
    editEl.hidden = false;
    closeTemplateSelector();
    positionBelow(comment);
    popup.classList.add('is-open', 'is-edit');
    clampPopupToViewport();
    lockedComment = comment;
    hoveredComment = null;
    // mousedown preventDefault で PM 選択が失われるのを防いでいるが、
    // input への focus は許可する
    inputEl.focus();
  };

  const confirmEdit = (): void => {
    const val = inputEl.value.trim();
    // hide() の前に lockedComment を保存する（hide() は lockedComment を null にリセットする）
    const targetEl = lockedComment ? resolveActionTarget(lockedComment) : null;
    hide();
    if (val.length > 0 && targetEl) {
      onEditConfirm(val, targetEl);
    }
  };

  const cancelEdit = (): void => {
    hide();
  };

  const removeComment = (): void => {
    const targetEl = lockedComment ? resolveActionTarget(lockedComment) : null;
    hide();
    if (targetEl && onRemoveComment) {
      onRemoveComment(targetEl);
    }
  };

  // --- イベント: ポップアップ内 ---

  // mousedown で PM のフォーカスを奪わない（ただし input は除外）
  popup.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('input')) return;
    e.preventDefault();
  });

  templateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void openTemplateSelectorFromButton();
  });
  confirmBtn.addEventListener('click', confirmEdit);
  removeBtn.addEventListener('click', removeComment);

  // 修正 F 改: Enter 2 回確定（IME 配慮・popover.ts と同型）
  // IME 変換中（isComposing=true）は何もしない（変換確定を許可）。
  // 変換中でない Enter: 1 回目は preventDefault + enterPending=true、
  // 2 回目で confirmEdit。他キー押下/input/blur でフラグリセット。
  let cpEnterPending = false;
  const resetCpEnterPending = (): void => {
    cpEnterPending = false;
  };
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.isComposing) return; // IME 変換確定 Enter は無視（変換を許可）
      e.preventDefault();
      if (!cpEnterPending) {
        cpEnterPending = true;
      } else {
        cpEnterPending = false;
        confirmEdit();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetCpEnterPending();
      cancelEdit();
    } else {
      resetCpEnterPending();
    }
  });
  inputEl.addEventListener('input', resetCpEnterPending);
  inputEl.addEventListener('blur', resetCpEnterPending);

  // --- イベント: editorRoot の hover/click デリゲーション ---

  const onMouseover = (e: MouseEvent): void => {
    if (!enabled) return;
    const comment = (e.target as HTMLElement).closest<HTMLElement>(targetSelector);
    if (!comment || comment === hoveredComment) return;
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (!lockedComment) showPreview(comment);
    }, 120);
  };

  const onMouseout = (e: MouseEvent): void => {
    if (!enabled) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related && popup.contains(related)) return; // popup 内に入った
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (!lockedComment && popup.classList.contains('is-open') && !isEditMode()) {
      hide();
    }
  };

  const onPopupMouseout = (e: MouseEvent): void => {
    if (!enabled || isEditMode()) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || (!popup.contains(related) && !editorRoot.contains(related))) {
      hide();
    }
  };

  // H5: 外クリック検出は editorRoot の capture ハンドラに統合する。
  // editorRoot.addEventListener('click', onClick, true) が capture で先に取り、
  // comment 外クリック（!editorRoot.contains(e.target)）を document 側でも
  // 検出できるように capture ハンドラに外クリック判定を含める。
  // document.addEventListener('click', onClick) は廃止（bubble/capture 不一致で leak が発生していた）。

  const onEditorRootClick = (e: MouseEvent): void => {
    if (!enabled) return;
    const comment = (e.target as HTMLElement).closest<HTMLElement>(targetSelector);
    if (comment) {
      e.stopPropagation();
      openEdit(comment);
      return;
    }
    // editorRoot 内だが comment 外クリック → 編集中なら確定
    if (lockedComment && !popup.contains(e.target as Node)) {
      confirmEdit();
    }
  };

  // editorRoot 外のクリック（document レベル capture）を検出して編集を確定する。
  // H5: capture フラグを true で統一（bubble 側は使わない）。
  const onDocumentCapture = (e: MouseEvent): void => {
    if (!enabled || !lockedComment) return;
    if (
      e.target instanceof HTMLElement &&
      e.target.closest(`.${TEMPLATE_SELECTOR_CLASS}`)
    )
      return;
    if (editorRoot.contains(e.target as Node) || popup.contains(e.target as Node)) return;
    // editorRoot の外をクリック → 確定
    confirmEdit();
  };

  editorRoot.addEventListener('mouseover', onMouseover);
  editorRoot.addEventListener('mouseout', onMouseout);
  editorRoot.addEventListener('click', onEditorRootClick, true); // H5: capture
  popup.addEventListener('mouseout', onPopupMouseout);
  document.addEventListener('click', onDocumentCapture, true); // H5: capture・外クリック専用

  return {
    setEnabled(next: boolean): void {
      if (enabled === next) return;
      enabled = next;
      if (!next) hide();
    },
    destroy(): void {
      unsubscribeLanguage();
      editorRoot.removeEventListener('mouseover', onMouseover);
      editorRoot.removeEventListener('mouseout', onMouseout);
      editorRoot.removeEventListener('click', onEditorRootClick, true); // H5: capture 統一
      popup.removeEventListener('mouseout', onPopupMouseout);
      document.removeEventListener('click', onDocumentCapture, true); // H5: capture 統一
      if (hoverTimer !== null) clearTimeout(hoverTimer);
      closeTemplateSelector();
      popup.remove();
    },
  };
}
