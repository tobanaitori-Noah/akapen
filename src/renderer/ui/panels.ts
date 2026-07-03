/**
 * 完了パネル＝計画2 Task 8 Step 1（完了ハンドラ 5.）。
 * 保存パス＋次に使うAIへ渡すための案内文＋コピー用ボタン。
 * レビュー中に base が外部変更されていた場合（ガード③）は注記を添える。
 */
import { onLanguageChange, t } from '../i18n';

export interface CompletionPanelHandle {
  element: HTMLElement;
  show(opts: { savedPath: string; baseChangedExternally: boolean }): void;
  hide(): void;
}

export interface DropOverlayHandle {
  element: HTMLElement;
  show(): void;
  hide(): void;
}

export function createDropOverlay(): DropOverlayHandle {
  const element = document.createElement('div');
  element.className = 'akapen-drop-overlay';
  element.hidden = true;
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML = `
    <div class="akapen-drop-overlay__zone">
      <div class="akapen-drop-overlay__icon" aria-hidden="true">MD</div>
      <p data-role="drop-message">${t('panel.dropMarkdown')}</p>
    </div>
  `;
  onLanguageChange(() => {
    const message = element.querySelector<HTMLParagraphElement>('[data-role="drop-message"]');
    if (message) message.textContent = t('panel.dropMarkdown');
  });

  return {
    element,
    show() {
      element.hidden = false;
      element.setAttribute('aria-hidden', 'false');
    },
    hide() {
      element.hidden = true;
      element.setAttribute('aria-hidden', 'true');
    },
  };
}

export function createCompletionPanel(): CompletionPanelHandle {
  const element = document.createElement('div');
  element.className = 'akapen-complete-panel is-hidden';
  element.innerHTML = `
    <div class="akapen-complete-panel__card">
      <h2 data-role="complete-title">${t('panel.reviewExported')}</h2>
      <p class="akapen-complete-panel__path" data-role="saved-path"></p>
      <button type="button" data-action="copy-path">${t('panel.copyPath')}</button>
      <p data-role="handoff-prompt">${t('panel.handoffPrompt')}</p>
      <p class="akapen-complete-panel__message" data-role="handoff-message"></p>
      <button type="button" data-action="copy-handoff-message">${t('panel.copyMessage')}</button>
      <p class="akapen-complete-panel__note is-hidden" data-role="base-changed-note">
        ${t('panel.baseChangedNote')}
      </p>
      <button type="button" data-action="panel-close">${t('panel.close')}</button>
    </div>
  `;

  const query = <T extends HTMLElement>(selector: string): T => {
    const el = element.querySelector<T>(selector);
    if (!el) throw new Error(`panel: ${selector} not found`);
    return el;
  };
  const pathEl = query<HTMLParagraphElement>('[data-role="saved-path"]');
  const messageEl = query<HTMLParagraphElement>('[data-role="handoff-message"]');
  const noteEl = query<HTMLParagraphElement>('[data-role="base-changed-note"]');
  let currentSavedPath = '';

  const renderText = (): void => {
    query<HTMLHeadingElement>('[data-role="complete-title"]').textContent = t('panel.reviewExported');
    query<HTMLButtonElement>('[data-action="copy-path"]').textContent = t('panel.copyPath');
    query<HTMLParagraphElement>('[data-role="handoff-prompt"]').textContent = t('panel.handoffPrompt');
    query<HTMLButtonElement>('[data-action="copy-handoff-message"]').textContent = t('panel.copyMessage');
    noteEl.textContent = t('panel.baseChangedNote');
    query<HTMLButtonElement>('[data-action="panel-close"]').textContent = t('panel.close');
    if (currentSavedPath) {
      messageEl.textContent = t('panel.handoffMessage', { path: currentSavedPath });
    }
  };

  query<HTMLButtonElement>('[data-action="copy-path"]').addEventListener('click', () => {
    void navigator.clipboard.writeText(pathEl.textContent ?? '');
  });
  query<HTMLButtonElement>('[data-action="copy-handoff-message"]').addEventListener('click', () => {
    void navigator.clipboard.writeText(messageEl.textContent ?? '');
  });
  query<HTMLButtonElement>('[data-action="panel-close"]').addEventListener('click', () => {
    element.classList.add('is-hidden');
  });

  onLanguageChange(renderText);
  renderText();

  return {
    element,
    show({ savedPath, baseChangedExternally }) {
      currentSavedPath = savedPath;
      pathEl.textContent = savedPath;
      messageEl.textContent = t('panel.handoffMessage', { path: savedPath });
      noteEl.classList.toggle('is-hidden', !baseChangedExternally);
      element.classList.remove('is-hidden');
    },
    hide() {
      element.classList.add('is-hidden');
    },
  };
}
