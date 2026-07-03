/**
 * バナー（ガード②③＋自動保存の失敗可視化）＝計画2 Task 8 Step 2／硬化ラウンド拡張。
 *
 * - ガード②（開封時の衝突記法警告）: 読込みフローで criticHits > 0 なら黄バナー
 *   常設表示＋閉じるボタン。
 * - ガード③（外部変更警告）: onBaseChanged で赤バナー常設表示。閉じても
 *   state.baseChangedExternally には残す（完了パネルにも注記＝panels.ts）。
 * - autosave-failed（赤）: 自動保存の write 失敗。成功で自動的に消える（hide あり）。
 * - warning（黄）: 単発の警告（autosave の read/list/remove 失敗・復元の表記差）。
 */
import { onLanguageChange, t } from '../i18n';

export interface BannersHandle {
  element: HTMLElement;
  /** ガード②: 元原稿に CriticMarkup 風文字列が N 箇所（黄バナー） */
  showCriticConflict(count: number): void;
  /** ガード③: base がレビュー中に外部で変更された（赤バナー） */
  showBaseChanged(): void;
  /** 自動保存の write 失敗（赤バナー。添削は続行可・成功で hideAutosaveFailed） */
  showAutosaveFailed(message: string): void;
  hideAutosaveFailed(): void;
  /** 単発の警告（黄バナー。メッセージは呼び出し側で組む） */
  showWarning(message: string): void;
  /** 修復通知（バナーは一文のみ、詳細は actions を集約してモーダル表示） */
  showRepairNotice(message: string, actions: readonly string[]): void;
  /** 読込みフローで前のファイルのバナーを消す */
  clear(): void;
}

interface Banner {
  el: HTMLElement;
  show(message: string, details?: readonly string[]): void;
  hide(): void;
}

function aggregateActions(actions: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const action of actions) {
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  return [...counts.entries()].map(([action, count]) => (count > 1 ? `${action} ×${count}` : action));
}

function createRepairModal(): {
  element: HTMLElement;
  show(actions: readonly string[]): void;
  hide(): void;
} {
  const element = document.createElement('div');
  element.className = 'akapen-repair-modal is-hidden';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-labelledby', 'akapen-repair-modal-title');
  element.innerHTML = `
    <div class="akapen-repair-modal__panel">
      <h2 id="akapen-repair-modal-title">${t('banners.repairTitle')}</h2>
      <ul data-role="repair-detail-list"></ul>
      <div class="akapen-repair-modal__actions">
        <button type="button" data-action="repair-detail-close">${t('banners.close')}</button>
      </div>
    </div>
  `;
  const list = element.querySelector<HTMLUListElement>('[data-role="repair-detail-list"]');
  const close = element.querySelector<HTMLButtonElement>('[data-action="repair-detail-close"]');
  if (!list || !close) throw new Error('repair modal: required elements not found');
  const hide = (): void => {
    element.classList.add('is-hidden');
  };
  close.addEventListener('click', hide);
  onLanguageChange(() => {
    element.querySelector<HTMLHeadingElement>('#akapen-repair-modal-title')!.textContent = t('banners.repairTitle');
    close.textContent = t('banners.close');
  });
  element.addEventListener('click', (event) => {
    if (event.target === element) hide();
  });
  return {
    element,
    show(actions) {
      list.textContent = '';
      for (const action of aggregateActions(actions)) {
        const item = document.createElement('li');
        item.textContent = action;
        list.appendChild(item);
      }
      element.classList.remove('is-hidden');
      close.focus();
    },
    hide,
  };
}

function createBanner(modifier: string, modal?: ReturnType<typeof createRepairModal>): Banner {
  const el = document.createElement('div');
  el.className = `akapen-banner akapen-banner--${modifier} is-hidden`;
  const text = document.createElement('span');
  text.className = 'akapen-banner__text';
  const details = document.createElement('button');
  details.type = 'button';
  details.dataset.action = `banner-details-${modifier}`;
  details.textContent = t('banners.details');
  details.hidden = true;
  const close = document.createElement('button');
  close.type = 'button';
  close.dataset.action = `banner-close-${modifier}`;
  close.textContent = t('banners.close');
  let currentDetails: readonly string[] = [];
  details.addEventListener('click', () => {
    if (modal && currentDetails.length > 0) modal.show(currentDetails);
  });
  close.addEventListener('click', () => {
    el.classList.add('is-hidden'); // 表示だけ閉じる（state には残す）
  });
  onLanguageChange(() => {
    details.textContent = t('banners.details');
    close.textContent = t('banners.close');
  });
  el.append(text, details, close);
  return {
    el,
    show(message, detailActions = []) {
      currentDetails = detailActions;
      text.textContent = message;
      details.hidden = detailActions.length === 0;
      el.classList.remove('is-hidden');
    },
    hide() {
      el.classList.add('is-hidden');
      details.hidden = true;
      currentDetails = [];
    },
  };
}

export function createBanners(): BannersHandle {
  const element = document.createElement('div');
  element.className = 'akapen-banners';
  const repairModal = createRepairModal();
  const conflict = createBanner('conflict');
  const baseChanged = createBanner('base-changed');
  const autosaveFailed = createBanner('autosave-failed');
  const warning = createBanner('warning', repairModal);
  element.append(conflict.el, baseChanged.el, autosaveFailed.el, warning.el, repairModal.element);

  return {
    element,
    showCriticConflict(count) {
      conflict.show(t('banners.conflict', { count }));
    },
    showBaseChanged() {
      baseChanged.show(t('banners.baseChanged'));
    },
    showAutosaveFailed(message) {
      autosaveFailed.show(t('banners.autosaveFailed', { message }));
    },
    hideAutosaveFailed() {
      autosaveFailed.hide();
    },
    showWarning(message) {
      warning.show(message);
    },
    showRepairNotice(message, actions) {
      warning.show(message, actions);
    },
    clear() {
      conflict.hide();
      baseChanged.hide();
      autosaveFailed.hide();
      warning.hide();
      repairModal.hide();
    },
  };
}
