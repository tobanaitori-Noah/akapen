/**
 * ツールバー（「開く」「保存」「▼」＋全体指示欄＋右上の表示モード切替＋TOCトグル）。
 * v1.2:
 *   G4: 見出しプルダウン（F5 select）を削除し、右上に「◀︎」TOC トグルボタンを追加。
 *   G6: 「完了」を「保存」に改名し、隣に「▼」ドロップダウン（名前をつけて保存）を追加。
 */
import type { ViewMode } from '../state';
import { onLanguageChange, t } from '../i18n';

/** G4: TOC に出す見出し1件（pos は app 側が保持＝ここは表示だけ） */
export interface OutlineHeading {
  level: number;
  text: string;
}

export interface ToolbarOptions {
  onOpen(): void;
  onSelectViewMode(mode: ViewMode): void;
  /** G4: TOC パネルの開閉トグル */
  onTocToggle(): void;
  onSave(): void;
  onSaveAs(): void;
  onUndo(): void;
  onRedo(): void;
  onGlobalNote(value: string): void;
  onShortcutSettings(): void;
}

export interface ToolbarHandle {
  element: HTMLElement;
  setFileLoaded(loaded: boolean): void;
  setViewMode(mode: ViewMode): void;
  setGlobalNote(value: string): void;
  setUndoRedoState(canUndo: boolean, canRedo: boolean): void;
  flashUndo(): void;
  flashRedo(): void;
  /** G4: TOC の open/close 状態をボタン表示に反映 */
  setTocOpen(open: boolean): void;
}

// アイコン（feather icons 同形）
const EYE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const CODE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const KEYBOARD_ICON =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M19 9h.01M7 13h.01M11 13h.01M15 13h.01M17 17H7"/></svg>';
const UNDO_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-1"/></svg>';
const REDO_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h1"/></svg>';

export function createToolbar(options: ToolbarOptions): ToolbarHandle {
  const element = document.createElement('header');
  element.className = 'akapen-toolbar';
  element.innerHTML = `
    <div class="akapen-toolbar__undoredo">
      <button type="button" data-action="undo" aria-label="${t('toolbar.undo')}" data-tooltip="${t('toolbar.undoTooltip')}" disabled>${UNDO_ICON}</button><button type="button" data-action="redo" aria-label="${t('toolbar.redo')}" data-tooltip="${t('toolbar.redoTooltip')}" disabled>${REDO_ICON}</button>
    </div>
    <button type="button" data-action="open" data-tooltip="${t('toolbar.openTooltip')}">${t('toolbar.open')}</button>
    <div class="akapen-toolbar__save-group">
      <button type="button" data-action="save" data-tooltip="${t('toolbar.saveTooltip')}" disabled>${t('toolbar.save')}</button>
      <button type="button" data-action="save-as-toggle" aria-label="${t('toolbar.saveMenu')}" aria-haspopup="true" aria-expanded="false" disabled>▼</button>
      <ul class="akapen-save-dropdown" data-role="save-dropdown" hidden>
        <li><button type="button" data-action="save-as">${t('toolbar.saveAs')}</button></li>
      </ul>
    </div>
    <div class="akapen-global-note" data-role="global-note-wrap">
      <input type="text" data-role="global-note" placeholder="${t('toolbar.globalNotePlaceholder')}" disabled />
      <textarea data-role="global-note-textarea" placeholder="${t('toolbar.globalNotePlaceholder')}" rows="4" hidden disabled></textarea>
      <button type="button" data-action="global-note-toggle" aria-label="${t('toolbar.globalNoteExpand')}" aria-expanded="false" data-tooltip="${t('toolbar.globalNoteExpandTooltip')}" disabled>▼</button>
    </div>
    <div class="akapen-toolbar__right" data-role="toolbar-right">
      <div class="akapen-view-switch" role="group" aria-label="${t('toolbar.viewMode')}" data-view-mode="preview">
        <button type="button" data-action="view-mode" data-mode="preview" class="is-active" aria-pressed="true" disabled>${EYE_ICON}<span data-role="viewer-label">${t('toolbar.viewer')}</span></button>
        <button type="button" data-action="view-mode" data-mode="source" aria-pressed="false" disabled>${CODE_ICON}<span data-role="code-label">${t('toolbar.code')}</span></button>
      </div>
      <button type="button" class="akapen-shortcuts-button" data-action="shortcut-settings" aria-label="${t('toolbar.shortcutSettings')}" data-tooltip="${t('toolbar.shortcutSettings')}">${KEYBOARD_ICON}</button>
      <button type="button" data-action="toc-toggle" aria-label="${t('toolbar.tocOpen')}" aria-expanded="false" class="akapen-toc-toggle" data-tooltip="${t('toolbar.tocTooltip')}" disabled>☰</button>
    </div>
    <div class="akapen-tooltip" data-role="tooltip" hidden></div>
  `;

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = element.querySelector<T>(selector);
    if (!el) throw new Error(`toolbar: ${selector} not found`);
    return el;
  };

  const viewSwitch = query<HTMLDivElement>('.akapen-view-switch');
  const segmentButtons = Array.from(
    element.querySelectorAll<HTMLButtonElement>('[data-action="view-mode"]'),
  );
  const viewSwitchPill = document.createElement('div');
  viewSwitchPill.className = 'akapen-view-switch__pill';
  viewSwitchPill.setAttribute('aria-hidden', 'true');
  viewSwitch.prepend(viewSwitchPill);
  const saveButton = query<HTMLButtonElement>('[data-action="save"]');
  const saveAsToggleButton = query<HTMLButtonElement>('[data-action="save-as-toggle"]');
  const saveDropdown = query<HTMLUListElement>('[data-role="save-dropdown"]');
  const undoButton = query<HTMLButtonElement>('[data-action="undo"]');
  const redoButton = query<HTMLButtonElement>('[data-action="redo"]');
  const noteInput = query<HTMLInputElement>('[data-role="global-note"]');
  const noteTextarea = query<HTMLTextAreaElement>('[data-role="global-note-textarea"]');
  const noteWrap = query<HTMLDivElement>('[data-role="global-note-wrap"]');
  const noteToggleButton = query<HTMLButtonElement>('[data-action="global-note-toggle"]');
  const tocToggleButton = query<HTMLButtonElement>('[data-action="toc-toggle"]');
  const shortcutSettingsButton = query<HTMLButtonElement>('[data-action="shortcut-settings"]');
  const tooltip = query<HTMLDivElement>('[data-role="tooltip"]');
  let viewSwitchPillFrame: number | null = null;
  let undoPressTimer: number | null = null;
  let redoPressTimer: number | null = null;

  const updateViewSwitchPill = (): void => {
    viewSwitchPillFrame = null;
    const activeButton = segmentButtons.find((button) => button.classList.contains('is-active'));
    if (!activeButton || activeButton.offsetWidth === 0) {
      viewSwitchPill.style.opacity = '0';
      return;
    }
    viewSwitchPill.style.width = `${activeButton.offsetWidth}px`;
    viewSwitchPill.style.transform = `translateX(${activeButton.offsetLeft}px)`;
    viewSwitchPill.style.opacity = '1';
  };

  const scheduleViewSwitchPillUpdate = (): void => {
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      updateViewSwitchPill();
      return;
    }
    if (viewSwitchPillFrame !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(viewSwitchPillFrame);
      }
      viewSwitchPillFrame = null;
    }
    viewSwitchPillFrame = window.requestAnimationFrame(updateViewSwitchPill);
  };

  const viewSwitchResizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => scheduleViewSwitchPillUpdate());
  viewSwitchResizeObserver?.observe(viewSwitch);

  const flashUndoButton = (): void => {
    if (undoButton.disabled) return;
    undoButton.classList.remove('is-pressing');
    void undoButton.offsetWidth;
    undoButton.classList.add('is-pressing');
    if (undoPressTimer !== null) window.clearTimeout(undoPressTimer);
    undoPressTimer = window.setTimeout(() => {
      undoButton.classList.remove('is-pressing');
      undoPressTimer = null;
    }, 180);
  };

  const flashRedoButton = (): void => {
    if (redoButton.disabled) return;
    redoButton.classList.remove('is-pressing');
    void redoButton.offsetWidth;
    redoButton.classList.add('is-pressing');
    if (redoPressTimer !== null) window.clearTimeout(redoPressTimer);
    redoPressTimer = window.setTimeout(() => {
      redoButton.classList.remove('is-pressing');
      redoPressTimer = null;
    }, 180);
  };

  const renderText = (): void => {
    undoButton.setAttribute('aria-label', t('toolbar.undo'));
    undoButton.dataset.tooltip = t('toolbar.undoTooltip');
    redoButton.setAttribute('aria-label', t('toolbar.redo'));
    redoButton.dataset.tooltip = t('toolbar.redoTooltip');
    const openButton = query<HTMLButtonElement>('[data-action="open"]');
    openButton.textContent = t('toolbar.open');
    openButton.dataset.tooltip = t('toolbar.openTooltip');
    saveButton.textContent = t('toolbar.save');
    saveButton.dataset.tooltip = t('toolbar.saveTooltip');
    saveAsToggleButton.setAttribute('aria-label', t('toolbar.saveMenu'));
    query<HTMLButtonElement>('[data-action="save-as"]').textContent = t('toolbar.saveAs');
    noteInput.placeholder = t('toolbar.globalNotePlaceholder');
    noteTextarea.placeholder = t('toolbar.globalNotePlaceholder');
    const expanded = noteWrap.classList.contains('is-expanded');
    noteToggleButton.setAttribute(
      'aria-label',
      expanded ? t('toolbar.globalNoteCollapse') : t('toolbar.globalNoteExpand'),
    );
    noteToggleButton.dataset.tooltip = expanded
      ? t('toolbar.globalNoteCollapseTooltip')
      : t('toolbar.globalNoteExpandTooltip');
    viewSwitch.setAttribute('aria-label', t('toolbar.viewMode'));
    query<HTMLSpanElement>('[data-role="viewer-label"]').textContent = t('toolbar.viewer');
    query<HTMLSpanElement>('[data-role="code-label"]').textContent = t('toolbar.code');
    const tocOpen = tocToggleButton.getAttribute('aria-expanded') === 'true';
    tocToggleButton.setAttribute('aria-label', tocOpen ? t('toolbar.tocClose') : t('toolbar.tocOpen'));
    tocToggleButton.dataset.tooltip = t('toolbar.tocTooltip');
    shortcutSettingsButton.setAttribute('aria-label', t('toolbar.shortcutSettings'));
    shortcutSettingsButton.dataset.tooltip = t('toolbar.shortcutSettings');
    scheduleViewSwitchPillUpdate();
  };

  let tooltipTimer: number | null = null;
  const hideTooltip = (): void => {
    if (tooltipTimer !== null) {
      window.clearTimeout(tooltipTimer);
      tooltipTimer = null;
    }
    tooltip.hidden = true;
  };
  const showTooltip = (target: HTMLElement, text: string): void => {
    if (tooltipTimer !== null) window.clearTimeout(tooltipTimer);
    tooltipTimer = window.setTimeout(() => {
      tooltip.textContent = text;
      tooltip.hidden = false;
      const targetRect = target.getBoundingClientRect();
      const hostRect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, targetRect.left - hostRect.left + targetRect.width / 2 - tooltipRect.width / 2),
        Math.max(8, hostRect.width - tooltipRect.width - 8),
      );
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${targetRect.bottom - hostRect.top + 8}px`;
    }, 500);
  };

  for (const target of Array.from(element.querySelectorAll<HTMLElement>('[data-tooltip]'))) {
    target.addEventListener('mouseenter', () => {
      if (target instanceof HTMLButtonElement && target.disabled) return;
      showTooltip(target, target.dataset.tooltip ?? '');
    });
    target.addEventListener('focus', () => {
      if (target instanceof HTMLButtonElement && target.disabled) return;
      showTooltip(target, target.dataset.tooltip ?? '');
    });
    target.addEventListener('mouseleave', hideTooltip);
    target.addEventListener('blur', hideTooltip);
  }

  // ▼ ドロップダウン開閉
  saveAsToggleButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !saveDropdown.hidden;
    saveDropdown.hidden = isOpen;
    saveAsToggleButton.setAttribute('aria-expanded', String(!isOpen));
  });

  // ドロップダウン外クリックで閉じる
  document.addEventListener('click', () => {
    saveDropdown.hidden = true;
    saveAsToggleButton.setAttribute('aria-expanded', 'false');
  });

  query<HTMLButtonElement>('[data-action="open"]').addEventListener('click', () => {
    options.onOpen();
  });
  saveButton.addEventListener('click', () => {
    options.onSave();
  });
  undoButton.addEventListener('click', () => {
    flashUndoButton();
    options.onUndo();
  });
  redoButton.addEventListener('click', () => {
    flashRedoButton();
    options.onRedo();
  });
  query<HTMLButtonElement>('[data-action="save-as"]').addEventListener('click', (e) => {
    e.stopPropagation();
    saveDropdown.hidden = true;
    saveAsToggleButton.setAttribute('aria-expanded', 'false');
    options.onSaveAs();
  });
  for (const button of segmentButtons) {
    button.addEventListener('click', () => {
      options.onSelectViewMode(button.dataset.mode === 'source' ? 'source' : 'preview');
    });
  }
  tocToggleButton.addEventListener('click', () => {
    options.onTocToggle();
  });
  shortcutSettingsButton.addEventListener('click', () => {
    options.onShortcutSettings();
  });
  noteInput.addEventListener('input', () => {
    noteTextarea.value = noteInput.value;
    options.onGlobalNote(noteInput.value);
  });
  noteTextarea.addEventListener('input', () => {
    noteInput.value = noteTextarea.value;
    options.onGlobalNote(noteTextarea.value);
  });
  noteToggleButton.addEventListener('click', () => {
    const expanded = !noteWrap.classList.contains('is-expanded');
    noteWrap.classList.toggle('is-expanded', expanded);
    noteInput.hidden = expanded;
    noteTextarea.hidden = !expanded;
    noteToggleButton.textContent = expanded ? '▲' : '▼';
    noteToggleButton.setAttribute('aria-expanded', String(expanded));
    noteToggleButton.setAttribute(
      'aria-label',
      expanded ? t('toolbar.globalNoteCollapse') : t('toolbar.globalNoteExpand'),
    );
    noteToggleButton.dataset.tooltip = expanded
      ? t('toolbar.globalNoteCollapseTooltip')
      : t('toolbar.globalNoteExpandTooltip');
    if (expanded) noteTextarea.focus();
    else noteInput.focus();
  });

  onLanguageChange(renderText);
  renderText();

  return {
    element,
    setFileLoaded(loaded) {
      for (const button of segmentButtons) button.disabled = !loaded;
      saveButton.disabled = !loaded;
      saveAsToggleButton.disabled = !loaded;
      undoButton.disabled = !loaded;
      redoButton.disabled = !loaded;
      noteInput.disabled = !loaded;
      noteTextarea.disabled = !loaded;
      noteToggleButton.disabled = !loaded;
      tocToggleButton.disabled = !loaded;
    },
    setViewMode(mode) {
      viewSwitch.dataset.viewMode = mode;
      for (const button of segmentButtons) {
        const active = button.dataset.mode === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      scheduleViewSwitchPillUpdate();
    },
    setGlobalNote(value) {
      noteInput.value = value;
      noteTextarea.value = value;
    },
    setUndoRedoState(canUndo, canRedo) {
      undoButton.disabled = !canUndo;
      redoButton.disabled = !canRedo;
    },
    flashUndo() {
      flashUndoButton();
    },
    flashRedo() {
      flashRedoButton();
    },
    setTocOpen(open) {
      tocToggleButton.setAttribute('aria-expanded', String(open));
      tocToggleButton.setAttribute('aria-label', open ? t('toolbar.tocClose') : t('toolbar.tocOpen'));
      // K5: アイコンは ☰ 固定（開閉でアイコンを変えない）
      tocToggleButton.textContent = '☰';
    },
  };
}
