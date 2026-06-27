/**
 * ツールバー（「開く」「保存」「▼」＋全体指示欄＋右上の表示モード切替＋TOCトグル）。
 * v1.2:
 *   G4: 見出しプルダウン（F5 select）を削除し、右上に「◀︎」TOC トグルボタンを追加。
 *   G6: 「完了」を「保存」に改名し、隣に「▼」ドロップダウン（名前をつけて保存）を追加。
 */
import type { ViewMode } from '../state';

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

export function createToolbar(options: ToolbarOptions): ToolbarHandle {
  const element = document.createElement('header');
  element.className = 'akapen-toolbar';
  element.innerHTML = `
    <div class="akapen-toolbar__undoredo">
      <button type="button" data-action="undo" aria-label="取り消す" data-tooltip="取り消す（⌘Z）" disabled>◀︎</button><button type="button" data-action="redo" aria-label="やり直す" data-tooltip="やり直す（⇧⌘Z）" disabled>▶︎</button>
    </div>
    <button type="button" data-action="open" data-tooltip="現在のデータを破棄して、新しいマークダウンファイルを開く">開く</button>
    <div class="akapen-toolbar__save-group">
      <button type="button" data-action="save" data-tooltip="元のファイルと同じ場所に <ファイル名>.akapen.md として保存" disabled>保存</button>
      <button type="button" data-action="save-as-toggle" aria-label="保存メニューを開く" aria-haspopup="true" aria-expanded="false" disabled>▼</button>
      <ul class="akapen-save-dropdown" data-role="save-dropdown" hidden>
        <li><button type="button" data-action="save-as">名前をつけて保存</button></li>
      </ul>
    </div>
    <div class="akapen-global-note" data-role="global-note-wrap">
      <input type="text" data-role="global-note" placeholder="全体指示（書き出し時に添える・任意）" disabled />
      <textarea data-role="global-note-textarea" placeholder="全体指示（書き出し時に添える・任意）" rows="4" hidden disabled></textarea>
      <button type="button" data-action="global-note-toggle" aria-label="全体指示欄を広げる" aria-expanded="false" data-tooltip="全体指示 入力エリアを広げる" disabled>▼</button>
    </div>
    <div class="akapen-toolbar__right" data-role="toolbar-right">
      <div class="akapen-view-switch" role="group" aria-label="表示モード" data-view-mode="preview">
        <button type="button" data-action="view-mode" data-mode="preview" class="is-active" aria-pressed="true" disabled>${EYE_ICON}ビュワー</button>
        <button type="button" data-action="view-mode" data-mode="source" aria-pressed="false" disabled>${CODE_ICON}コード</button>
      </div>
      <button type="button" data-action="toc-toggle" aria-label="見出しパネルを開く" aria-expanded="false" class="akapen-toc-toggle" data-tooltip="見出し" disabled>☰</button>
    </div>
    <button type="button" class="akapen-shortcuts-button" data-action="shortcut-settings" aria-label="ショートカットの変更" data-tooltip="ショートカットの変更">${KEYBOARD_ICON}</button>
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
    options.onUndo();
  });
  redoButton.addEventListener('click', () => {
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
      expanded ? '全体指示欄を1行に戻す' : '全体指示欄を広げる',
    );
    noteToggleButton.dataset.tooltip = expanded
      ? '全体指示 入力エリアを縮小'
      : '全体指示 入力エリアを広げる';
    if (expanded) noteTextarea.focus();
    else noteInput.focus();
  });

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
    },
    setGlobalNote(value) {
      noteInput.value = value;
      noteTextarea.value = value;
    },
    setUndoRedoState(canUndo, canRedo) {
      undoButton.disabled = !canUndo;
      redoButton.disabled = !canRedo;
    },
    setTocOpen(open) {
      tocToggleButton.setAttribute('aria-expanded', String(open));
      tocToggleButton.setAttribute('aria-label', open ? '見出しパネルを閉じる' : '見出しパネルを開く');
      // K5: アイコンは ☰ 固定（開閉でアイコンを変えない）
      tocToggleButton.textContent = '☰';
    },
  };
}
