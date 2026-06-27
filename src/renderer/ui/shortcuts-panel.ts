import type {
  ShortcutBindings,
  ShortcutCommandDefinition,
  ShortcutCommandId,
} from '../shortcuts';
import {
  bindingToDisplay,
  normalizeShortcutEvent,
  validateShortcutCandidate,
} from '../shortcuts';

export const FONT_SIZE_MIN = 50;
export const FONT_SIZE_MAX = 200;
export const FONT_SIZE_STEP = 5;
export const FONT_SIZE_DEFAULT = 100;

export interface ShortcutSettingsPanelHandle {
  element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  setBindings(bindings: ShortcutBindings): void;
  /** K7: 文字サイズを設定パネルの表示に反映（setZoom からも呼ぶ） */
  setFontSize(pct: number): void;
  destroy(): void;
}

export interface ShortcutSettingsPanelOptions {
  commands: readonly ShortcutCommandDefinition[];
  bindings: ShortcutBindings;
  onChange(commandId: ShortcutCommandId, binding: string): Promise<boolean> | boolean;
  onReset(): Promise<boolean> | boolean;
  /** K7: 文字サイズ変更コールバック（% 整数で渡す） */
  onFontSizeChange(pct: number): void;
  /** K7: 起動時の文字サイズ初期値（%） */
  initialFontSize: number;
}

export function createShortcutSettingsPanel(
  options: ShortcutSettingsPanelOptions,
): ShortcutSettingsPanelHandle {
  let bindings: ShortcutBindings = { ...options.bindings };
  let capturing: ShortcutCommandId | null = null;
  let currentFontSize: number = options.initialFontSize;

  const element = document.createElement('div');
  element.className = 'akapen-shortcuts-panel';
  element.hidden = true;
  element.innerHTML = `
    <div class="akapen-shortcuts-panel__card" role="dialog" aria-modal="true" aria-label="設定">
      <div class="akapen-shortcuts-panel__header">
        <h2>設定</h2>
        <button type="button" data-action="shortcut-close" aria-label="閉じる">×</button>
      </div>
      <div class="akapen-shortcuts-panel__section-title">文字サイズ</div>
      <div class="akapen-fontsize-row">
        <div class="akapen-fontsize-slider-wrap">
          <input type="range" class="akapen-fontsize-range"
            min="${FONT_SIZE_MIN}" max="${FONT_SIZE_MAX}" step="${FONT_SIZE_STEP}"
            value="${options.initialFontSize}"
            aria-label="文字サイズ">
          <div class="akapen-fontsize-marks">
            <span class="akapen-fontsize-mark--min">${FONT_SIZE_MIN}</span>
            <span class="akapen-fontsize-mark--mid">100</span>
            <span class="akapen-fontsize-mark--max">${FONT_SIZE_MAX}</span>
          </div>
        </div>
        <span class="akapen-fontsize-pct">
          <span class="akapen-fontsize-stepper">
            <button type="button" data-action="fontsize-up" aria-label="文字を大きく">▲</button>
            <button type="button" data-action="fontsize-down" aria-label="文字を小さく">▼</button>
          </span>
          <input type="text" class="akapen-fontsize-input" value="${options.initialFontSize}" aria-label="文字サイズ（%）" inputmode="numeric"><span>%</span>
        </span>
        <button type="button" class="akapen-fontsize-reset" data-action="fontsize-reset">デフォルトに戻す</button>
      </div>
      <div class="akapen-shortcuts-panel__sep"></div>
      <div class="akapen-shortcuts-panel__section-title">ショートカット</div>
      <div class="akapen-shortcuts-panel__warning" data-role="shortcut-warning" hidden></div>
      <div class="akapen-shortcuts-panel__list" data-role="shortcut-list"></div>
      <div class="akapen-shortcuts-panel__actions">
        <button type="button" data-action="shortcut-reset">既定に戻す</button>
      </div>
    </div>
  `;

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = element.querySelector<T>(selector);
    if (!el) throw new Error(`shortcuts-panel: ${selector} not found`);
    return el;
  };
  const listEl = query<HTMLDivElement>('[data-role="shortcut-list"]');
  const warningEl = query<HTMLDivElement>('[data-role="shortcut-warning"]');

  // --- 文字サイズ UI ---
  const rangeEl = query<HTMLInputElement>('.akapen-fontsize-range');
  const inputEl = query<HTMLInputElement>('.akapen-fontsize-input');

  const clampFontSize = (v: number): number =>
    Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(v)));

  const syncFontSizeUI = (pct: number): void => {
    rangeEl.value = String(pct);
    inputEl.value = String(pct);
  };

  const applyFontSize = (pct: number): void => {
    const clamped = clampFontSize(pct);
    currentFontSize = clamped;
    syncFontSizeUI(clamped);
    options.onFontSizeChange(clamped);
  };

  rangeEl.addEventListener('input', () => {
    applyFontSize(Number(rangeEl.value));
  });

  inputEl.addEventListener('change', () => {
    // 空文字は Number('') === 0 と評価され 50 にスナップしてしまうため、先に弾いて直前値に戻す。
    // Number.isFinite は NaN/±Infinity をすべて false にするので isNaN の併用は不要。
    const raw = inputEl.value.trim();
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v)) {
      syncFontSizeUI(currentFontSize);
      return;
    }
    applyFontSize(v);
  });

  // %入力欄のキーボード操作は意図的に ±1 刻み（スライダー/▲▼ボタンの ±5 とは別の細かい調整経路）。
  // 多くの数値入力 UI と同じ動き＝Arrow=細かく / ボタン=刻みで一気に。
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      applyFontSize(currentFontSize + 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      applyFontSize(currentFontSize - 1);
    }
  });

  query<HTMLButtonElement>('[data-action="fontsize-up"]').addEventListener('click', () => {
    applyFontSize(currentFontSize + FONT_SIZE_STEP);
  });

  query<HTMLButtonElement>('[data-action="fontsize-down"]').addEventListener('click', () => {
    applyFontSize(currentFontSize - FONT_SIZE_STEP);
  });

  query<HTMLButtonElement>('[data-action="fontsize-reset"]').addEventListener('click', () => {
    applyFontSize(FONT_SIZE_DEFAULT);
  });

  const showWarning = (message: string): void => {
    warningEl.textContent = message;
    warningEl.hidden = false;
  };

  const hideWarning = (): void => {
    warningEl.textContent = '';
    warningEl.hidden = true;
  };

  const render = (): void => {
    listEl.innerHTML = '';
    for (const command of options.commands) {
      const row = document.createElement('div');
      row.className = 'akapen-shortcuts-panel__row';
      row.dataset.commandId = command.id;
      const label = document.createElement('span');
      label.className = 'akapen-shortcuts-panel__label';
      label.textContent = command.label;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.role = 'shortcut-binding';
      button.dataset.commandId = command.id;
      button.textContent =
        capturing === command.id ? 'キーを押してください' : bindingToDisplay(bindings[command.id]);
      button.classList.toggle('is-capturing', capturing === command.id);
      button.addEventListener('click', () => {
        capturing = command.id;
        hideWarning();
        render();
      });
      row.append(label, button);
      listEl.appendChild(row);
    }
  };

  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (element.hidden || !capturing) return;
    if (event.key === 'Meta' || event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const binding = normalizeShortcutEvent(event);
    const validation = validateShortcutCandidate(binding, bindings, capturing);
    if (!validation.ok || binding === null) {
      showWarning(validation.ok ? 'このキーは割り当てられません。' : validation.message);
      render();
      return;
    }
    const commandId = capturing;
    void Promise.resolve(options.onChange(commandId, binding)).then((ok) => {
      if (!ok) {
        showWarning('ショートカットを保存できませんでした。');
        render();
        return;
      }
      bindings = { ...bindings, [commandId]: binding };
      capturing = null;
      hideWarning();
      render();
    });
  };
  document.addEventListener('keydown', onKeyDownCapture, true);

  query<HTMLButtonElement>('[data-action="shortcut-close"]').addEventListener('click', () => {
    element.hidden = true;
    capturing = null;
    hideWarning();
    render();
  });

  query<HTMLButtonElement>('[data-action="shortcut-reset"]').addEventListener('click', () => {
    void Promise.resolve(options.onReset()).then((ok) => {
      if (!ok) {
        showWarning('既定値へ戻せませんでした。');
        return;
      }
      capturing = null;
      hideWarning();
      render();
    });
  });

  render();

  return {
    element,
    open() {
      element.hidden = false;
      hideWarning();
      syncFontSizeUI(currentFontSize);
      render();
      const firstButton = listEl.querySelector<HTMLButtonElement>('[data-role="shortcut-binding"]');
      firstButton?.focus();
    },
    close() {
      element.hidden = true;
      capturing = null;
      hideWarning();
      render();
    },
    toggle() {
      if (element.hidden) {
        element.hidden = false;
        const firstButton = listEl.querySelector<HTMLButtonElement>('[data-role="shortcut-binding"]');
        firstButton?.focus();
      } else {
        element.hidden = true;
        capturing = null;
        hideWarning();
        render();
      }
    },
    setBindings(next) {
      bindings = { ...next };
      render();
    },
    setFontSize(pct: number) {
      currentFontSize = clampFontSize(pct);
      syncFontSizeUI(currentFontSize);
    },
    destroy() {
      document.removeEventListener('keydown', onKeyDownCapture, true);
    },
  };
}
