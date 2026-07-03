import { getLanguage, onLanguageChange, t, type AkapenLanguage } from '../i18n';
import {
  COMMENT_TEMPLATE_PRESETS,
  type CommentTemplate,
  createCustomTemplate,
  getCommentTemplateText,
  isCommentTemplateFeatureUnlocked,
  loadCommentTemplates,
  normalizeCommentTemplates,
  saveCommentTemplates,
} from './comment-templates';

export interface TemplateManagerHandle {
  element: HTMLDialogElement;
  open(): Promise<void>;
  destroy(): void;
}

const presetById = new Map(COMMENT_TEMPLATE_PRESETS.map((item) => [item.id, item]));
type TemplateManagerTab = 'preset' | 'custom';

export function createTemplateManager(): TemplateManagerHandle {
  let templates: CommentTemplate[] = normalizeCommentTemplates([]);
  let loading = false;
  let displayLanguage: AkapenLanguage = getLanguage();
  let displayLanguageOverridden = false;
  let activeTab: TemplateManagerTab = 'preset';

  const dialog = document.createElement('dialog');
  dialog.className = 'akapen-template-manager';
  dialog.innerHTML = `
    <div class="akapen-template-manager__body">
      <div class="akapen-template-manager__header">
        <div class="akapen-template-manager__title-copy">
          <h2 data-role="template-title">${t('templateManager.title')}</h2>
        </div>
        <button type="button" data-action="template-close" aria-label="${t('settings.close')}">×</button>
      </div>
      <div class="akapen-template-manager__controls">
        <div class="akapen-template-manager__tabs" role="tablist" aria-label="${t('templateManager.title')}">
          <button type="button" role="tab" data-template-tab="preset" aria-selected="true">${t('templateManager.preset')}</button>
          <button type="button" role="tab" data-template-tab="custom" aria-selected="false">${t('templateManager.custom')}</button>
        </div>
        <div class="akapen-template-manager__language" role="group" aria-label="${t('settings.language')}">
          <div class="akapen-template-manager__language-switch">
            <button type="button" data-template-language="ja" aria-pressed="true">${t('settings.languageJapanese')}</button>
            <button type="button" data-template-language="en" aria-pressed="false">${t('settings.languageEnglish')}</button>
          </div>
        </div>
      </div>
      <div class="akapen-template-manager__warning" data-role="template-warning" hidden></div>
      <div class="akapen-template-manager__list" data-role="template-list"></div>
      <div class="akapen-template-manager__actions">
        <div class="akapen-template-manager__actions-left">
          <button type="button" class="akapen-template-manager__reset-all" data-action="template-reset-all" hidden>${t('templateManager.resetAllDiffs')}</button>
          <button type="button" data-action="template-add">${t('templateManager.add')}</button>
        </div>
        <button type="button" class="akapen-template-manager__done" data-action="template-save" data-primary="true">${t('templateManager.saveClose')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`template-manager: ${selector} not found`);
    return el;
  };

  const listEl = query<HTMLDivElement>('[data-role="template-list"]');
  const warningEl = query<HTMLDivElement>('[data-role="template-warning"]');
  const titleEl = query<HTMLHeadingElement>('[data-role="template-title"]');
  const languageGroup = query<HTMLDivElement>('.akapen-template-manager__language');
  const languageSwitch = query<HTMLDivElement>('.akapen-template-manager__language-switch');
  const tabsEl = query<HTMLDivElement>('.akapen-template-manager__tabs');
  const closeBtn = query<HTMLButtonElement>('[data-action="template-close"]');
  const addBtn = query<HTMLButtonElement>('[data-action="template-add"]');
  const resetAllBtn = query<HTMLButtonElement>('[data-action="template-reset-all"]');
  const saveBtn = query<HTMLButtonElement>('[data-action="template-save"]');
  const tabButtons = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>('[data-template-tab]'),
  );
  const languageButtons = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>('[data-template-language]'),
  );
  const tabPill = document.createElement('div');
  tabPill.className = 'akapen-template-manager__tab-pill';
  tabPill.setAttribute('aria-hidden', 'true');
  tabsEl.prepend(tabPill);
  const languagePill = document.createElement('div');
  languagePill.className = 'akapen-template-manager__language-pill';
  languagePill.setAttribute('aria-hidden', 'true');
  languageSwitch.prepend(languagePill);
  let pillFrame: number | null = null;
  let pillRevealReady = false;

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
        button.getAttribute('aria-selected') === 'true' ||
        button.getAttribute('aria-pressed') === 'true',
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
    updatePill(tabButtons, tabPill, tabsEl);
    updatePill(languageButtons, languagePill, languageSwitch);
  };

  const hidePillsUntilMeasured = (): void => {
    pillRevealReady = false;
    tabPill.classList.remove('is-ready');
    languagePill.classList.remove('is-ready');
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

  const pillResizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => schedulePillUpdate());
  pillResizeObserver?.observe(tabsEl);
  pillResizeObserver?.observe(languageSwitch);

  const presetDiffers = (template: CommentTemplate): boolean => {
    const preset = presetById.get(template.id);
    if (!preset) return false;
    return (
      template.text !== preset.text ||
      (template.textEn ?? '') !== (preset.textEn ?? '')
    );
  };

  const hasPresetDiffs = (): boolean =>
    templates.some((template) => template.isPreset && presetDiffers(template));

  const syncFooterActions = (): void => {
    addBtn.hidden = activeTab !== 'custom';
    resetAllBtn.hidden = loading || activeTab !== 'preset' || !hasPresetDiffs();
  };

  const renderText = (): void => {
    titleEl.textContent = t('templateManager.title');
    languageGroup.setAttribute('aria-label', t('settings.language'));
    closeBtn.setAttribute('aria-label', t('settings.close'));
    addBtn.textContent = `+ ${t('templateManager.add')}`;
    resetAllBtn.textContent = t('templateManager.resetAllDiffs');
    saveBtn.textContent = t('templateManager.saveClose');
    for (const button of tabButtons) {
      const tab = button.dataset.templateTab;
      const active = tab === activeTab;
      button.textContent = tab === 'custom' ? t('templateManager.custom') : t('templateManager.preset');
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const button of languageButtons) {
      const language = button.dataset.templateLanguage;
      const active = language === displayLanguage;
      button.textContent =
        language === 'en' ? t('settings.languageEnglish') : t('settings.languageJapanese');
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    syncFooterActions();
    schedulePillUpdate();
  };

  const render = (): void => {
    listEl.innerHTML = '';
    syncFooterActions();
    if (loading) {
      const row = document.createElement('div');
      row.className = 'akapen-template-manager__empty';
      row.textContent = t('commentTemplate.loading');
      listEl.appendChild(row);
      return;
    }

    const visibleTemplates = templates.filter((template) =>
      activeTab === 'preset' ? template.isPreset : !template.isPreset,
    );
    if (visibleTemplates.length === 0) {
      const row = document.createElement('div');
      row.className = 'akapen-template-manager__empty';
      row.textContent = t('commentTemplate.empty');
      listEl.appendChild(row);
      return;
    }

    for (const template of visibleTemplates) {
      const row = document.createElement('div');
      row.className = 'akapen-template-manager__row';
      row.dataset.templateId = template.id;
      row.classList.toggle('is-preset', template.isPreset);
      row.classList.toggle('is-custom', !template.isPreset);

      const editor = document.createElement('div');
      editor.className = 'akapen-template-manager__editor';
      const textLabel = document.createElement('label');
      const textArea = document.createElement('textarea');
      const textAreaLanguage =
        displayLanguage === 'en' ? t('settings.languageEnglish') : t('settings.languageJapanese');
      textArea.rows = 3;
      textArea.setAttribute('aria-label', `${textAreaLanguage} ${t('templateManager.title')}`);
      textArea.value = displayLanguage === 'en' ? template.textEn ?? '' : template.text;
      textArea.placeholder =
        displayLanguage === 'en'
          ? t('templateManager.textEnPlaceholder')
          : t('templateManager.textPlaceholder');
      textLabel.appendChild(textArea);
      editor.appendChild(textLabel);

      if (template.isPreset) {
        const preset = presetById.get(template.id);
        if (preset) {
          const reference = document.createElement('div');
          reference.className = 'akapen-template-manager__reference';
          const referenceText = document.createElement('span');
          referenceText.className = 'akapen-template-manager__reference-text';
          const referenceValue = getCommentTemplateText(preset, displayLanguage);
          referenceText.textContent = `↩ ${referenceValue}`;
          referenceText.setAttribute(
            'aria-label',
            `${t('templateManager.referenceLabel')}: ${referenceValue}`,
          );
          reference.appendChild(referenceText);
          editor.appendChild(reference);
        }
      }

      const actions = document.createElement('div');
      actions.className = 'akapen-template-manager__row-actions';
      const syncDiffState = (): void => {
        row.classList.toggle('is-diff', template.isPreset && presetDiffers(template));
        syncFooterActions();
      };

      textArea.addEventListener('input', () => {
        if (displayLanguage === 'en') {
          template.textEn = textArea.value.trim() ? textArea.value : undefined;
        } else {
          template.text = textArea.value;
        }
        syncDiffState();
      });

      if (template.isPreset) {
        syncDiffState();
      } else {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'akapen-template-manager__delete';
        remove.dataset.action = 'template-delete';
        remove.textContent = '×';
        remove.setAttribute('aria-label', t('templateManager.delete'));
        remove.title = t('templateManager.delete');
        remove.addEventListener('click', () => {
          templates = templates.filter((item) => item.id !== template.id);
          render();
        });
        actions.appendChild(remove);
      }

      row.append(editor, actions);
      listEl.appendChild(row);
    }
  };

  const persistAndClose = async (): Promise<void> => {
    hideWarning();
    try {
      templates = normalizeCommentTemplates(templates);
      await saveCommentTemplates(templates);
      dialog.close();
    } catch (error) {
      showWarning(
        t('templateManager.saveFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const pulseSaveButton = (): void => {
    saveBtn.classList.remove('is-pulsing');
    void saveBtn.offsetWidth;
    saveBtn.classList.add('is-pulsing');
  };

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
  resetAllBtn.addEventListener('click', () => {
    for (const template of templates) {
      if (!template.isPreset) continue;
      const preset = presetById.get(template.id);
      if (!preset) continue;
      template.text = preset.text;
      template.textEn = preset.textEn;
    }
    render();
  });
  addBtn.addEventListener('click', () => {
    const newTemplateText = t('templateManager.newTemplate');
    const custom =
      displayLanguage === 'en'
        ? createCustomTemplate(newTemplateText, newTemplateText)
        : createCustomTemplate(newTemplateText);
    const firstCustomIndex = templates.findIndex((template) => !template.isPreset);
    templates =
      firstCustomIndex === -1
        ? [...templates, custom]
        : [
            ...templates.slice(0, firstCustomIndex),
            custom,
            ...templates.slice(firstCustomIndex),
          ];
    activeTab = 'custom';
    render();
    listEl.querySelector<HTMLTextAreaElement>('.akapen-template-manager__row textarea')?.focus();
  });
  for (const button of languageButtons) {
    button.addEventListener('click', () => {
      const language = button.dataset.templateLanguage;
      if (language !== 'ja' && language !== 'en') return;
      displayLanguage = language;
      displayLanguageOverridden = true;
      renderText();
      render();
    });
  }
  for (const button of tabButtons) {
    button.addEventListener('click', () => {
      activeTab = button.dataset.templateTab === 'custom' ? 'custom' : 'preset';
      renderText();
      render();
    });
  }
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

  const unsubscribeLanguage = onLanguageChange((language) => {
    if (!displayLanguageOverridden) displayLanguage = language;
    renderText();
    render();
  });

  renderText();
  render();

  return {
    element: dialog,
    async open() {
      hideWarning();
      loading = true;
      displayLanguage = getLanguage();
      displayLanguageOverridden = false;
      activeTab = 'preset';
      hidePillsUntilMeasured();
      renderText();
      render();
      if (!dialog.open) dialog.showModal();
      const templatesPromise = loadCommentTemplates();
      await waitForPillLayout();
      revealMeasuredPills();
      templates = await templatesPromise;
      loading = false;
      renderText();
      render();
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

export function attachTemplateManagerToSettingsPanel(
  manager: TemplateManagerHandle,
  root: ParentNode = document,
): () => void {
  const card = root.querySelector<HTMLElement>('.akapen-shortcuts-panel__card');
  if (!card || card.querySelector('[data-role="akapen-template-settings"]')) {
    return () => undefined;
  }

  const sep = document.createElement('div');
  sep.className = 'akapen-shortcuts-panel__sep';
  sep.dataset.role = 'akapen-template-settings';
  const header = document.createElement('div');
  header.className = 'akapen-shortcuts-panel__section-header';
  header.dataset.role = 'akapen-template-settings';
  const title = document.createElement('div');
  title.className = 'akapen-shortcuts-panel__section-title';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'akapen-shortcuts-panel__section-action';
  button.addEventListener('click', async () => {
    let unlocked = false;
    try {
      unlocked = await isCommentTemplateFeatureUnlocked();
    } catch {
      unlocked = false;
    }
    if (!unlocked) {
      window.dispatchEvent(
        new CustomEvent('akapen:premium-required', {
          detail: { feature: 'comment-templates' },
        }),
      );
      return;
    }
    void manager.open();
  });
  header.append(title, button);

  const renderText = (): void => {
    title.textContent = t('templateManager.settingsTitle');
    button.textContent = t('templateManager.manage');
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
