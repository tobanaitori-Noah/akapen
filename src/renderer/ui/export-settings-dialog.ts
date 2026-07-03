import { getLanguage, onLanguageChange, t } from '../i18n';
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_FILE_NAME_PRESETS,
  applyExportFileNamePattern,
  buildExportHeader,
  isExportSettingsFeatureUnlocked,
  loadExportSettings,
  normalizeExportSettings,
  saveExportSettings,
  type ExportHeaderPresetId,
  type ExportSettings,
} from './export-settings';

export interface ExportSettingsDialogHandle {
  element: HTMLDialogElement;
  open(): Promise<void>;
  destroy(): void;
}

interface ExportSettingsDialogOptions {
  onSaved?: (settings: ExportSettings) => void;
}

interface ExportSettingsUnfoldControl {
  classList: {
    toggle(token: string, force?: boolean): boolean | void;
  };
  setAttribute?(name: string, value: string): void;
}

export function syncExportSettingsUnfold(
  headerPreset: string,
  customHeaderField: ExportSettingsUnfoldControl,
  fileNamePatternMode: string,
  customPatternField: ExportSettingsUnfoldControl,
): void {
  const headerOpen = headerPreset === 'custom';
  const patternOpen = fileNamePatternMode === 'custom';
  customHeaderField.classList.toggle('is-unfold', headerOpen);
  customHeaderField.setAttribute?.('aria-hidden', headerOpen ? 'false' : 'true');
  customPatternField.classList.toggle('is-unfold', patternOpen);
  customPatternField.setAttribute?.('aria-hidden', patternOpen ? 'false' : 'true');
}

const SAMPLE_DEFAULT_HEADER_JA = [
  '# AI向け読み取りルール（CriticMarkup）',
  '',
  '- `{--text--}` は削除提案です。',
  '- `{++text++}` は追記提案です。',
  '- `{==target==}{>>instruction<<}` は対象範囲へのコメントです。',
].join('\n');

const SAMPLE_DEFAULT_HEADER_EN = [
  '# Reading guide for AI (CriticMarkup)',
  '',
  '- `{--text--}` is a deletion suggestion.',
  '- `{++text++}` is an addition suggestion.',
  '- `{==target==}{>>instruction<<}` is a comment for the wrapped target.',
].join('\n');

export function createExportSettingsDialog(
  options: ExportSettingsDialogOptions = {},
): ExportSettingsDialogHandle {
  let settings = normalizeExportSettings(DEFAULT_EXPORT_SETTINGS);
  let fileNamePatternMode = 'akapen';
  let customFileNamePattern = DEFAULT_EXPORT_SETTINGS.fileNamePattern;
  let loading = false;

  const dialog = document.createElement('dialog');
  dialog.className = 'akapen-export-settings-dialog';
  dialog.innerHTML = `
    <div class="akapen-export-settings-dialog__body">
      <div class="akapen-export-settings-dialog__header">
        <h2 data-role="export-settings-title">${t('exportSettings.title')}</h2>
        <button type="button" data-action="export-settings-close" aria-label="${t('settings.close')}">×</button>
      </div>
      <div class="akapen-export-settings-dialog__warning" data-role="export-settings-warning" hidden></div>
      <div class="akapen-export-settings-dialog__empty" data-role="export-settings-loading" hidden>${t('exportSettings.loading')}</div>
      <div class="akapen-export-settings-dialog__form" data-role="export-settings-form">
        <section class="akapen-export-settings-dialog__section">
          <div class="akapen-export-settings-dialog__pill-switch akapen-export-settings-dialog__header-switch" role="radiogroup" aria-label="${t('exportSettings.headerPreset')}">
            <div class="akapen-export-settings-dialog__header-pill" aria-hidden="true"></div>
            <button type="button" role="radio" data-export-header-preset="default" class="is-active" aria-checked="true">${t('exportSettings.headerPreset.default')}</button>
            <button type="button" role="radio" data-export-header-preset="custom" aria-checked="false">${t('exportSettings.headerPreset.custom')}</button>
          </div>
          <div class="akapen-export-settings-dialog__field akapen-export-settings-dialog__field--unfold" data-role="export-header-custom-field" aria-hidden="true">
            <textarea data-role="export-header-custom" rows="6" aria-label="${t('exportSettings.headerCustomText')}" placeholder="${t('exportSettings.headerCustomPlaceholder')}"></textarea>
          </div>
        </section>

        <section class="akapen-export-settings-dialog__section">
          <div class="akapen-export-settings-dialog__pill-switch akapen-export-settings-dialog__pattern-switch" role="radiogroup" aria-label="${t('exportSettings.fileNamePattern')}">
            <div class="akapen-export-settings-dialog__pattern-pill" aria-hidden="true"></div>
            <button type="button" role="radio" data-export-file-pattern="akapen" class="is-active" aria-checked="true">${t('exportSettings.fileNamePattern.akapen')}</button>
            <button type="button" role="radio" data-export-file-pattern="review" aria-checked="false">${t('exportSettings.fileNamePattern.review')}</button>
            <button type="button" role="radio" data-export-file-pattern="reviewed" aria-checked="false">${t('exportSettings.fileNamePattern.reviewed')}</button>
            <button type="button" role="radio" data-export-file-pattern="custom" aria-checked="false">${t('exportSettings.fileNamePattern.custom')}</button>
          </div>
          <div class="akapen-export-settings-dialog__field akapen-export-settings-dialog__field--unfold" data-role="export-file-pattern-custom-field" aria-hidden="true">
            <input data-role="export-file-pattern-custom" aria-label="${t('exportSettings.fileNamePatternCustom')}" placeholder="${DEFAULT_EXPORT_SETTINGS.fileNamePattern}" />
          </div>
        </section>

        <div class="akapen-export-settings-dialog__preview">
          <div data-role="export-settings-preview-file" class="akapen-export-settings-dialog__preview-file"></div>
          <pre data-role="export-settings-preview-header"></pre>
        </div>
      </div>
      <div class="akapen-export-settings-dialog__actions">
        <div class="akapen-export-settings-dialog__actions-left">
          <button type="button" class="akapen-export-settings-dialog__reset" data-action="export-settings-reset" hidden>${t('exportSettings.resetToDefault')}</button>
        </div>
        <button type="button" class="akapen-export-settings-dialog__done" data-action="export-settings-save" data-primary="true">${t('exportSettings.saveClose')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`export-settings-dialog: ${selector} not found`);
    return el;
  };

  const titleEl = query<HTMLHeadingElement>('[data-role="export-settings-title"]');
  const warningEl = query<HTMLDivElement>('[data-role="export-settings-warning"]');
  const loadingEl = query<HTMLDivElement>('[data-role="export-settings-loading"]');
  const formEl = query<HTMLDivElement>('[data-role="export-settings-form"]');
  const headerSwitch = query<HTMLDivElement>('.akapen-export-settings-dialog__header-switch');
  const patternSwitch = query<HTMLDivElement>('.akapen-export-settings-dialog__pattern-switch');
  const customHeaderField = query<HTMLDivElement>('[data-role="export-header-custom-field"]');
  const customPatternField = query<HTMLDivElement>('[data-role="export-file-pattern-custom-field"]');
  const customHeader = query<HTMLTextAreaElement>('[data-role="export-header-custom"]');
  const customPattern = query<HTMLInputElement>('[data-role="export-file-pattern-custom"]');
  const previewFile = query<HTMLDivElement>('[data-role="export-settings-preview-file"]');
  const previewHeader = query<HTMLPreElement>('[data-role="export-settings-preview-header"]');
  const closeBtn = query<HTMLButtonElement>('[data-action="export-settings-close"]');
  const resetBtn = query<HTMLButtonElement>('[data-action="export-settings-reset"]');
  const saveBtn = query<HTMLButtonElement>('[data-action="export-settings-save"]');
  const headerButtons = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>('[data-export-header-preset]'),
  );
  const patternButtons = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>('[data-export-file-pattern]'),
  );
  const headerPill = query<HTMLDivElement>('.akapen-export-settings-dialog__header-pill');
  const patternPill = query<HTMLDivElement>('.akapen-export-settings-dialog__pattern-pill');
  let pillFrame: number | null = null;
  let pillRevealReady = false;

  const patternModeFor = (value: string): string =>
    EXPORT_FILE_NAME_PRESETS.find((item) => item.pattern === value)?.id ?? 'custom';

  const hasDefaultDiff = (): boolean =>
    settings.headerPreset !== DEFAULT_EXPORT_SETTINGS.headerPreset ||
    settings.headerCustomText !== DEFAULT_EXPORT_SETTINGS.headerCustomText ||
    settings.fileNamePattern !== DEFAULT_EXPORT_SETTINGS.fileNamePattern;

  const showWarning = (message: string): void => {
    warningEl.textContent = message;
    warningEl.hidden = false;
  };

  const hideWarning = (): void => {
    warningEl.textContent = '';
    warningEl.hidden = true;
  };

  const updatePill = (
    buttons: readonly HTMLButtonElement[],
    pill: HTMLElement,
    track: HTMLElement,
  ): void => {
    const activeButton = buttons.find(
      (button) =>
        button.classList.contains('is-active') ||
        button.getAttribute('aria-checked') === 'true',
    );
    if (!activeButton) {
      pill.classList.remove('is-ready');
      return;
    }
    const trackRect = track.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    if (trackRect.width === 0 || buttonRect.width === 0) {
      pill.classList.remove('is-ready');
      return;
    }
    pill.style.width = `${buttonRect.width}px`;
    pill.style.transform = `translateX(${buttonRect.left - trackRect.left}px)`;
    pill.classList.toggle('is-ready', pillRevealReady);
  };

  const updatePills = (): void => {
    pillFrame = null;
    updatePill(headerButtons, headerPill, headerSwitch);
    updatePill(patternButtons, patternPill, patternSwitch);
  };

  const hidePillsUntilMeasured = (): void => {
    pillRevealReady = false;
    headerPill.classList.remove('is-ready');
    patternPill.classList.remove('is-ready');
  };

  const revealMeasuredPills = (): void => {
    pillRevealReady = true;
    updatePills();
  };

  const waitForPillLayout = (): Promise<void> =>
    new Promise((resolve) => {
      if (
        typeof window === 'undefined' ||
        typeof window.requestAnimationFrame !== 'function'
      ) {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

  const schedulePillUpdate = (): void => {
    if (
      typeof window === 'undefined' ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      updatePills();
      return;
    }
    if (pillFrame !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(pillFrame);
      }
      pillFrame = null;
    }
    pillFrame = window.requestAnimationFrame(updatePills);
  };

  const recalculatePillIndicators = (): void => {
    if (pillFrame !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(pillFrame);
    }
    pillFrame = null;
    updatePills();
  };

  const nextPillButton = (
    buttons: readonly HTMLButtonElement[],
    currentButton: HTMLButtonElement,
    key: string,
  ): HTMLButtonElement | null => {
    const currentIndex = buttons.indexOf(currentButton);
    if (currentIndex === -1) return null;
    switch (key) {
      case 'ArrowRight':
      case 'ArrowDown':
        return buttons[(currentIndex + 1) % buttons.length] ?? null;
      case 'ArrowLeft':
      case 'ArrowUp':
        return buttons[(currentIndex - 1 + buttons.length) % buttons.length] ?? null;
      case 'Home':
        return buttons[0] ?? null;
      case 'End':
        return buttons[buttons.length - 1] ?? null;
      default:
        return null;
    }
  };

  const pillResizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => schedulePillUpdate());
  pillResizeObserver?.observe(headerSwitch);
  pillResizeObserver?.observe(patternSwitch);

  const renderText = (): void => {
    titleEl.textContent = t('exportSettings.title');
    closeBtn.setAttribute('aria-label', t('settings.close'));
    loadingEl.textContent = t('exportSettings.loading');
    headerSwitch.setAttribute('aria-label', t('exportSettings.headerPreset'));
    patternSwitch.setAttribute('aria-label', t('exportSettings.fileNamePattern'));
    customHeader.setAttribute('aria-label', t('exportSettings.headerCustomText'));
    customHeader.placeholder = t('exportSettings.headerCustomPlaceholder');
    customPattern.setAttribute('aria-label', t('exportSettings.fileNamePatternCustom'));
    customPattern.placeholder = DEFAULT_EXPORT_SETTINGS.fileNamePattern;
    resetBtn.textContent = t('exportSettings.resetToDefault');
    saveBtn.textContent = t('exportSettings.saveClose');

    for (const button of headerButtons) {
      const preset = button.dataset.exportHeaderPreset;
      if (preset === 'default' || preset === 'custom') {
        button.textContent = t(
          `exportSettings.headerPreset.${preset}` as Parameters<typeof t>[0],
        );
      }
    }
    for (const button of patternButtons) {
      const pattern = button.dataset.exportFilePattern;
      if (!pattern) continue;
      button.textContent = t(
        `exportSettings.fileNamePattern.${pattern}` as Parameters<typeof t>[0],
      );
    }
  };

  const renderPreview = (): void => {
    const defaultHeader = getLanguage() === 'en' ? SAMPLE_DEFAULT_HEADER_EN : SAMPLE_DEFAULT_HEADER_JA;
    previewFile.textContent = applyExportFileNamePattern('sample.md', settings);
    previewHeader.textContent = buildExportHeader(defaultHeader, settings, getLanguage());
  };

  const syncLoading = (): void => {
    loadingEl.hidden = !loading;
    formEl.hidden = loading;
    saveBtn.disabled = loading;
    resetBtn.hidden = loading || !hasDefaultDiff();
  };

  const syncControls = (): void => {
    for (const button of headerButtons) {
      const active = button.dataset.exportHeaderPreset === settings.headerPreset;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    }
    for (const button of patternButtons) {
      const active = button.dataset.exportFilePattern === fileNamePatternMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    }
    syncExportSettingsUnfold(
      settings.headerPreset,
      customHeaderField,
      fileNamePatternMode,
      customPatternField,
    );
    customHeader.tabIndex = settings.headerPreset === 'custom' ? 0 : -1;
    customPattern.tabIndex = fileNamePatternMode === 'custom' ? 0 : -1;
    syncLoading();
    renderPreview();
    schedulePillUpdate();
  };

  const readSettingsFromForm = (): void => {
    customFileNamePattern = customPattern.value;
    const selectedPattern = EXPORT_FILE_NAME_PRESETS.find(
      (item) => item.id === fileNamePatternMode,
    );
    settings = normalizeExportSettings({
      headerPreset: settings.headerPreset,
      headerCustomText: customHeader.value,
      fileNamePattern: selectedPattern ? selectedPattern.pattern : customPattern.value,
    });
  };

  const writeSettingsToForm = (): void => {
    customHeader.value = settings.headerCustomText;
    customPattern.value =
      fileNamePatternMode === 'custom' ? settings.fileNamePattern : customFileNamePattern;
    syncControls();
  };

  const pulseSaveButton = (): void => {
    saveBtn.classList.remove('is-pulsing');
    void saveBtn.offsetWidth;
    saveBtn.classList.add('is-pulsing');
  };

  const persistAndClose = async (): Promise<void> => {
    hideWarning();
    try {
      readSettingsFromForm();
      settings = await saveExportSettings(settings);
      options.onSaved?.(settings);
      dialog.close();
    } catch (error) {
      showWarning(
        t('exportSettings.saveFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      syncControls();
    }
  };

  const selectHeaderPreset = (preset: string): void => {
    if (preset !== 'default' && preset !== 'custom') return;
    settings = normalizeExportSettings({
      ...settings,
      headerPreset: preset satisfies ExportHeaderPresetId,
    });
    readSettingsFromForm();
    syncControls();
    recalculatePillIndicators();
  };

  const selectFileNamePatternMode = (mode: string): void => {
    if (
      mode !== 'custom' &&
      !EXPORT_FILE_NAME_PRESETS.some((item) => item.id === mode)
    ) {
      return;
    }
    fileNamePatternMode = mode;
    readSettingsFromForm();
    syncControls();
    recalculatePillIndicators();
  };

  customHeader.addEventListener('input', () => {
    readSettingsFromForm();
    syncControls();
  });
  customPattern.addEventListener('input', () => {
    readSettingsFromForm();
    syncControls();
  });
  for (const button of headerButtons) {
    button.addEventListener('click', () => {
      selectHeaderPreset(button.dataset.exportHeaderPreset ?? '');
    });
    button.addEventListener('keydown', (event) => {
      const nextButton = nextPillButton(headerButtons, button, event.key);
      if (!nextButton) return;
      event.preventDefault();
      selectHeaderPreset(nextButton.dataset.exportHeaderPreset ?? '');
      nextButton.focus({ preventScroll: true });
    });
  }
  for (const button of patternButtons) {
    button.addEventListener('click', () => {
      selectFileNamePatternMode(button.dataset.exportFilePattern ?? '');
    });
    button.addEventListener('keydown', (event) => {
      const nextButton = nextPillButton(patternButtons, button, event.key);
      if (!nextButton) return;
      event.preventDefault();
      selectFileNamePatternMode(nextButton.dataset.exportFilePattern ?? '');
      nextButton.focus({ preventScroll: true });
    });
  }
  saveBtn.addEventListener('animationend', () => {
    saveBtn.classList.remove('is-pulsing');
  });
  closeBtn.addEventListener('click', () => {
    void persistAndClose();
  });
  saveBtn.addEventListener('click', () => {
    pulseSaveButton();
    void persistAndClose();
  });
  resetBtn.addEventListener('click', () => {
    settings = normalizeExportSettings(DEFAULT_EXPORT_SETTINGS);
    fileNamePatternMode = patternModeFor(settings.fileNamePattern);
    customFileNamePattern = DEFAULT_EXPORT_SETTINGS.fileNamePattern;
    writeSettingsToForm();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    pulseSaveButton();
    void persistAndClose();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    void persistAndClose();
  });

  const unsubscribeLanguage = onLanguageChange(() => {
    renderText();
    syncControls();
  });

  renderText();
  hidePillsUntilMeasured();
  writeSettingsToForm();

  return {
    element: dialog,
    async open() {
      hideWarning();
      loading = true;
      hidePillsUntilMeasured();
      syncControls();
      if (!dialog.open) dialog.showModal();
      settings = await loadExportSettings();
      fileNamePatternMode = patternModeFor(settings.fileNamePattern);
      customFileNamePattern =
        fileNamePatternMode === 'custom'
          ? settings.fileNamePattern
          : DEFAULT_EXPORT_SETTINGS.fileNamePattern;
      loading = false;
      renderText();
      writeSettingsToForm();
      await waitForPillLayout();
      revealMeasuredPills();
    },
    destroy() {
      if (pillFrame !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(pillFrame);
      }
      pillResizeObserver?.disconnect();
      unsubscribeLanguage();
      dialog.remove();
    },
  };
}

export function attachExportSettingsToSettingsPanel(
  dialog: ExportSettingsDialogHandle,
  root: ParentNode = document,
): () => void {
  const card = root.querySelector<HTMLElement>('.akapen-shortcuts-panel__card');
  if (!card || card.querySelector('[data-role="akapen-export-settings"]')) {
    return () => undefined;
  }

  const sep = document.createElement('div');
  sep.className = 'akapen-shortcuts-panel__sep';
  sep.dataset.role = 'akapen-export-settings';
  const header = document.createElement('div');
  header.className = 'akapen-shortcuts-panel__section-header';
  header.dataset.role = 'akapen-export-settings';
  const title = document.createElement('div');
  title.className = 'akapen-shortcuts-panel__section-title';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'akapen-shortcuts-panel__section-action';
  button.addEventListener('click', async () => {
    let unlocked = false;
    try {
      unlocked = await isExportSettingsFeatureUnlocked();
    } catch {
      unlocked = false;
    }
    if (!unlocked) {
      void window.dispatchEvent(
        new CustomEvent('akapen:premium-required', {
          detail: { feature: 'export-settings' },
        }),
      );
      return;
    }
    void dialog.open();
  });
  header.append(title, button);

  const renderText = (): void => {
    title.textContent = t('exportSettings.settingsTitle');
    button.textContent = t('exportSettings.manage');
  };
  renderText();
  const unsubscribeLanguage = onLanguageChange(renderText);

  const languageSection = card.querySelector<HTMLElement>('[data-role="language-settings"]');
  if (languageSection) {
    card.insertBefore(sep, languageSection);
    card.insertBefore(header, languageSection);
  } else {
    card.append(sep, header);
  }

  return () => {
    unsubscribeLanguage();
    sep.remove();
    header.remove();
  };
}
