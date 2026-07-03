import type {
  ShortcutBindings,
  ShortcutCommandDefinition,
  ShortcutCommandId,
} from '../shortcuts';
import type { AkapenLanguage, AkapenTheme } from '../bridge';
import { onLanguageChange, t } from '../i18n';
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
  setTheme(theme: AkapenTheme): void;
  setLanguage(language: AkapenLanguage): void;
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
  onThemeChange(theme: AkapenTheme): void;
  initialTheme: AkapenTheme;
  onLanguageChange(language: AkapenLanguage): void;
  initialLanguage: AkapenLanguage;
}

export function createShortcutSettingsPanel(
  options: ShortcutSettingsPanelOptions,
): ShortcutSettingsPanelHandle {
  let bindings: ShortcutBindings = { ...options.bindings };
  let capturing: ShortcutCommandId | null = null;
  let currentFontSize: number = options.initialFontSize;
  let currentTheme: AkapenTheme = options.initialTheme;
  let currentLanguage: AkapenLanguage = options.initialLanguage;
  let shortcutsExpanded = false;
  let closeTimer: number | null = null;

  const element = document.createElement('div');
  element.className = 'akapen-shortcuts-panel';
  element.hidden = true;
  element.innerHTML = `
    <div class="akapen-shortcuts-panel__card" role="dialog" aria-modal="true" aria-label="${t('settings.title')}">
      <div class="akapen-shortcuts-panel__header">
        <h2 data-role="settings-title">${t('settings.title')}</h2>
        <button type="button" data-action="shortcut-close" aria-label="${t('settings.close')}">×</button>
      </div>
      <div class="akapen-settings-section" data-section="font-size">
        <div class="akapen-shortcuts-panel__section-title" data-role="fontsize-title">${t('settings.fontSize')}</div>
        <div class="akapen-fontsize-row">
          <div class="akapen-fontsize-slider-wrap">
            <input type="range" class="akapen-fontsize-range"
              min="${FONT_SIZE_MIN}" max="${FONT_SIZE_MAX}" step="${FONT_SIZE_STEP}"
              value="${options.initialFontSize}"
              aria-label="${t('settings.fontSize')}">
            <div class="akapen-fontsize-marks">
              <span class="akapen-fontsize-mark--min">${FONT_SIZE_MIN}</span>
              <span class="akapen-fontsize-mark--mid">100</span>
              <span class="akapen-fontsize-mark--max">${FONT_SIZE_MAX}</span>
            </div>
          </div>
          <span class="akapen-fontsize-pct">
            <span class="akapen-fontsize-stepper">
              <button type="button" data-action="fontsize-up" aria-label="${t('settings.fontLarger')}">▲</button>
              <button type="button" data-action="fontsize-down" aria-label="${t('settings.fontSmaller')}">▼</button>
            </span>
            <input type="text" class="akapen-fontsize-input" value="${options.initialFontSize}" aria-label="${t('settings.fontSizePercent')}" inputmode="numeric"><span>%</span>
          </span>
          <button type="button" class="akapen-fontsize-reset" data-action="fontsize-reset">${t('settings.default')}</button>
        </div>
      </div>
      <div class="akapen-settings-section" data-section="theme">
        <div class="akapen-shortcuts-panel__section-title" data-role="theme-title">${t('settings.theme')}</div>
        <div class="akapen-theme-row" role="group" aria-label="${t('settings.theme')}">
          <button type="button" class="akapen-theme-option" data-theme-value="light">${t('settings.themeLight')}</button>
          <button type="button" class="akapen-theme-option" data-theme-value="dark">${t('settings.themeDark')}</button>
          <button type="button" class="akapen-theme-option" data-theme-value="auto">${t('settings.themeAuto')}</button>
        </div>
      </div>
      <div class="akapen-shortcuts-panel__sep" data-section="shortcuts"></div>
      <div class="akapen-settings-section" data-section="shortcuts">
        <div class="akapen-shortcuts-panel__section-header">
          <div class="akapen-shortcuts-panel__section-title" data-role="shortcuts-title">${t('settings.shortcuts')}</div>
          <button type="button" class="akapen-shortcuts-panel__toggle" data-action="shortcut-toggle" aria-expanded="false">${t('settings.shortcutsExpand')}</button>
        </div>
        <div class="akapen-shortcuts-panel__shortcut-content" data-role="shortcut-content" hidden>
          <div class="akapen-shortcuts-panel__warning" data-role="shortcut-warning" hidden></div>
          <div class="akapen-shortcuts-panel__list" data-role="shortcut-list"></div>
          <div class="akapen-shortcuts-panel__actions">
            <button type="button" data-action="shortcut-reset">${t('settings.shortcutReset')}</button>
          </div>
        </div>
      </div>
      <div data-role="language-settings" class="akapen-settings-section">
        <div class="akapen-shortcuts-panel__sep"></div>
        <div class="akapen-shortcuts-panel__section-header">
          <div class="akapen-shortcuts-panel__section-title" data-role="language-title">${t('settings.language')}</div>
          <div class="akapen-language-row" role="group" aria-label="${t('settings.language')}">
            <button type="button" class="akapen-language-option" data-language-value="ja">${t('settings.languageJapanese')}</button>
            <button type="button" class="akapen-language-option" data-language-value="en">${t('settings.languageEnglish')}</button>
          </div>
        </div>
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
  const shortcutsContentEl = query<HTMLDivElement>('[data-role="shortcut-content"]');
  const shortcutsToggleBtn = query<HTMLButtonElement>('[data-action="shortcut-toggle"]');

  // --- 文字サイズ UI ---
  const rangeEl = query<HTMLInputElement>('.akapen-fontsize-range');
  const inputEl = query<HTMLInputElement>('.akapen-fontsize-input');
  const themeRow = query<HTMLDivElement>('.akapen-theme-row');
  const languageRow = query<HTMLDivElement>('.akapen-language-row');
  const themeButtons = Array.from(
    element.querySelectorAll<HTMLButtonElement>('[data-theme-value]'),
  );
  const languageButtons = Array.from(
    element.querySelectorAll<HTMLButtonElement>('[data-language-value]'),
  );
  const themePill = document.createElement('div');
  themePill.className = 'akapen-theme-pill';
  themePill.setAttribute('aria-hidden', 'true');
  themeRow.prepend(themePill);
  const languagePill = document.createElement('div');
  languagePill.className = 'akapen-language-pill';
  languagePill.setAttribute('aria-hidden', 'true');
  languageRow.prepend(languagePill);
  let segmentPillFrame: number | null = null;

  const updateSegmentPill = (
    buttons: readonly HTMLButtonElement[],
    pill: HTMLElement,
  ): void => {
    const activeButton = buttons.find((button) => button.classList.contains('is-active'));
    if (!activeButton || activeButton.offsetWidth === 0) {
      pill.style.opacity = '0';
      return;
    }
    pill.style.width = `${activeButton.offsetWidth}px`;
    pill.style.transform = `translateX(${activeButton.offsetLeft}px)`;
    pill.style.opacity = '1';
  };

  const updateSegmentPills = (): void => {
    segmentPillFrame = null;
    updateSegmentPill(themeButtons, themePill);
    updateSegmentPill(languageButtons, languagePill);
  };

  const scheduleSegmentPillsUpdate = (): void => {
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      updateSegmentPills();
      return;
    }
    if (segmentPillFrame !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(segmentPillFrame);
      }
      segmentPillFrame = null;
    }
    segmentPillFrame = window.requestAnimationFrame(updateSegmentPills);
  };

  const segmentResizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => scheduleSegmentPillsUpdate());
  segmentResizeObserver?.observe(themeRow);
  segmentResizeObserver?.observe(languageRow);

  const renderText = (): void => {
    const card = query<HTMLDivElement>('.akapen-shortcuts-panel__card');
    card.setAttribute('aria-label', t('settings.title'));
    query<HTMLHeadingElement>('[data-role="settings-title"]').textContent = t('settings.title');
    query<HTMLButtonElement>('[data-action="shortcut-close"]').setAttribute('aria-label', t('settings.close'));
    query<HTMLDivElement>('[data-role="fontsize-title"]').textContent = t('settings.fontSize');
    rangeEl.setAttribute('aria-label', t('settings.fontSize'));
    query<HTMLButtonElement>('[data-action="fontsize-up"]').setAttribute('aria-label', t('settings.fontLarger'));
    query<HTMLButtonElement>('[data-action="fontsize-down"]').setAttribute('aria-label', t('settings.fontSmaller'));
    inputEl.setAttribute('aria-label', t('settings.fontSizePercent'));
    query<HTMLButtonElement>('[data-action="fontsize-reset"]').textContent = t('settings.default');
    query<HTMLDivElement>('[data-role="theme-title"]').textContent = t('settings.theme');
    query<HTMLDivElement>('.akapen-theme-row').setAttribute('aria-label', t('settings.theme'));
    query<HTMLButtonElement>('[data-theme-value="light"]').textContent = t('settings.themeLight');
    query<HTMLButtonElement>('[data-theme-value="dark"]').textContent = t('settings.themeDark');
    query<HTMLButtonElement>('[data-theme-value="auto"]').textContent = t('settings.themeAuto');
    query<HTMLDivElement>('[data-role="shortcuts-title"]').textContent = t('settings.shortcuts');
    shortcutsToggleBtn.textContent = shortcutsExpanded ? '▲' : '▼';
    shortcutsToggleBtn.setAttribute(
      'aria-label',
      shortcutsExpanded ? t('settings.shortcutsCollapse') : t('settings.shortcutsExpand'),
    );
    query<HTMLButtonElement>('[data-action="shortcut-reset"]').textContent = t('settings.shortcutReset');
    query<HTMLDivElement>('[data-role="language-title"]').textContent = t('settings.language');
    query<HTMLDivElement>('.akapen-language-row').setAttribute('aria-label', t('settings.language'));
    query<HTMLButtonElement>('[data-language-value="ja"]').textContent = t('settings.languageJapanese');
    query<HTMLButtonElement>('[data-language-value="en"]').textContent = t('settings.languageEnglish');
    scheduleSegmentPillsUpdate();
  };

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

  const syncThemeUI = (theme: AkapenTheme): void => {
    for (const button of themeButtons) {
      const active = button.dataset.themeValue === theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    scheduleSegmentPillsUpdate();
  };

  const syncLanguageUI = (language: AkapenLanguage): void => {
    for (const button of languageButtons) {
      const active = button.dataset.languageValue === language;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    scheduleSegmentPillsUpdate();
  };

  const applyTheme = (theme: AkapenTheme): void => {
    currentTheme = theme;
    syncThemeUI(theme);
    options.onThemeChange(theme);
  };

  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      const theme = button.dataset.themeValue;
      if (theme === 'light' || theme === 'dark' || theme === 'auto') {
        applyTheme(theme);
      }
    });
  }

  syncThemeUI(currentTheme);
  syncLanguageUI(currentLanguage);

  for (const button of languageButtons) {
    button.addEventListener('click', () => {
      const language = button.dataset.languageValue;
      if (language === 'ja' || language === 'en') {
        currentLanguage = language;
        syncLanguageUI(language);
        options.onLanguageChange(language);
      }
    });
  }

  const unsubscribeLanguage = onLanguageChange((language) => {
    currentLanguage = language;
    renderText();
    syncLanguageUI(language);
    render();
  });

  const showWarning = (message: string): void => {
    warningEl.textContent = message;
    warningEl.hidden = false;
  };

  const hideWarning = (): void => {
    warningEl.textContent = '';
    warningEl.hidden = true;
  };

  const syncShortcutsDisclosure = (): void => {
    shortcutsContentEl.hidden = !shortcutsExpanded;
    shortcutsToggleBtn.setAttribute('aria-expanded', shortcutsExpanded ? 'true' : 'false');
    shortcutsToggleBtn.textContent = shortcutsExpanded ? '▲' : '▼';
    shortcutsToggleBtn.setAttribute(
      'aria-label',
      shortcutsExpanded ? t('settings.shortcutsCollapse') : t('settings.shortcutsExpand'),
    );
  };

  const resetPanelState = (): void => {
    capturing = null;
    shortcutsExpanded = false;
    syncShortcutsDisclosure();
    hideWarning();
    render();
  };

  const prefersReducedMotion = (): boolean =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const showPanel = (): void => {
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    element.hidden = false;
    element.classList.remove('is-closing');
    element.classList.add('is-open');
  };

  const hidePanel = (): void => {
    if (element.hidden && closeTimer === null) return;
    resetPanelState();
    element.classList.remove('is-open');
    if (prefersReducedMotion()) {
      element.classList.remove('is-closing');
      element.hidden = true;
      return;
    }
    element.classList.add('is-closing');
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      element.hidden = true;
      element.classList.remove('is-closing');
      closeTimer = null;
    }, 220);
  };

  const render = (): void => {
    listEl.innerHTML = '';
    for (const command of options.commands) {
      const row = document.createElement('div');
      row.className = 'akapen-shortcuts-panel__row';
      row.dataset.commandId = command.id;
      const label = document.createElement('span');
      label.className = 'akapen-shortcuts-panel__label';
      label.textContent = t(command.labelKey);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.role = 'shortcut-binding';
      button.dataset.commandId = command.id;
      button.textContent =
        capturing === command.id ? t('settings.pressKey') : bindingToDisplay(bindings[command.id]);
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
      showWarning(validation.ok ? t('shortcut.invalidKey') : validation.message);
      render();
      return;
    }
    const commandId = capturing;
    void Promise.resolve(options.onChange(commandId, binding)).then((ok) => {
      if (!ok) {
        showWarning(t('settings.shortcutCannotSave'));
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
    hidePanel();
  });

  shortcutsToggleBtn.addEventListener('click', () => {
    shortcutsExpanded = !shortcutsExpanded;
    if (!shortcutsExpanded) {
      capturing = null;
      hideWarning();
      render();
    }
    syncShortcutsDisclosure();
  });

  query<HTMLButtonElement>('[data-action="shortcut-reset"]').addEventListener('click', () => {
    void Promise.resolve(options.onReset()).then((ok) => {
      if (!ok) {
        showWarning(t('settings.shortcutCannotReset'));
        return;
      }
      capturing = null;
      hideWarning();
      render();
    });
  });

  render();
  syncShortcutsDisclosure();
  scheduleSegmentPillsUpdate();

  return {
    element,
    open() {
      showPanel();
      shortcutsExpanded = false;
      syncShortcutsDisclosure();
      hideWarning();
      syncFontSizeUI(currentFontSize);
      syncThemeUI(currentTheme);
      syncLanguageUI(currentLanguage);
      render();
      scheduleSegmentPillsUpdate();
      shortcutsToggleBtn.focus();
    },
    close() {
      hidePanel();
    },
    toggle() {
      if (element.hidden) {
        showPanel();
        shortcutsExpanded = false;
        syncShortcutsDisclosure();
        syncThemeUI(currentTheme);
        syncLanguageUI(currentLanguage);
        scheduleSegmentPillsUpdate();
        shortcutsToggleBtn.focus();
      } else {
        hidePanel();
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
    setTheme(theme: AkapenTheme) {
      currentTheme = theme;
      syncThemeUI(currentTheme);
    },
    setLanguage(language: AkapenLanguage) {
      currentLanguage = language;
      syncLanguageUI(currentLanguage);
    },
    destroy() {
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      if (segmentPillFrame !== null) window.cancelAnimationFrame(segmentPillFrame);
      segmentResizeObserver?.disconnect();
      document.removeEventListener('keydown', onKeyDownCapture, true);
      unsubscribeLanguage();
    },
  };
}
