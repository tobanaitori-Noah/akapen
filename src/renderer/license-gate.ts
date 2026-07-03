import type { LicenseApiResult } from './bridge-web';
import { onLanguageChange, t, type TranslationKey } from './i18n';

const CHECKOUT_URL_STANDARD = 'https://buy.polar.sh/polar_cl_elVIqlJG60KiZ6ApP4b5hd7JYVjyHPfGs5MFE14ytSU';
const CHECKOUT_URL_SUPPORTER = 'https://buy.polar.sh/polar_cl_VpJIdymnwMcXL6BCFPAXWZVDuveWPKvRjQDdH0LBigX';

type LicenseClient = {
  status(): Promise<LicenseApiResult>;
  activate(key: string): Promise<LicenseApiResult>;
  deactivate(): Promise<LicenseApiResult>;
};

export type PremiumFeature = 'tabs' | 'comment-templates' | 'export-settings';

export function normalizePremiumFeature(value: unknown): PremiumFeature {
  return value === 'comment-templates' || value === 'export-settings' ? value : 'tabs';
}

export function premiumFeatureDetailKey(feature: PremiumFeature): TranslationKey {
  if (feature === 'comment-templates') return 'premium.featureGateDetail.commentTemplates';
  if (feature === 'export-settings') return 'premium.featureGateDetail.exportSettings';
  return 'premium.featureGateDetail.tabs';
}

export interface LicenseGateHandle {
  element: HTMLDialogElement;
  attachToSettingsPanel(): void;
  open(): void;
  openPlanComparison(): void;
  refresh(): Promise<void>;
}

const STYLE = `
/* --- 共通トークン（デジタル庁準拠） --- */
.akapen-license-dialog,
.akapen-plan-popup,
.akapen-license-detail-popup {
  font-family: "Noto Sans JP","Hiragino Sans",-apple-system,sans-serif;
  color: #1A1A1C;
  border: none;
  border-radius: 8px;
  padding: 0;
  box-shadow: 0 16px 48px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06);
}
.akapen-license-dialog::backdrop,
.akapen-plan-popup::backdrop,
.akapen-license-detail-popup::backdrop { background: rgba(0,0,0,.35); }

/* --- ライセンス管理ダイアログ --- */
.akapen-license-dialog { width: min(480px, calc(100vw - 32px)); }
.ld-body { padding: 20px 24px; display: grid; gap: 16px; }
.ld-header { display: flex; align-items: center; justify-content: space-between; }
.ld-header h2 { margin: 0; font-size: 17px; font-weight: 700; }
.ld-close {
  width: 36px; height: 36px; border: 1px solid #D9D9DD; border-radius: 6px;
  background: #fff; font-size: 16px; cursor: pointer; color: #595959;
  display: flex; align-items: center; justify-content: center;
}
.ld-close:hover { background: #F8F8FB; }
.ld-status {
  padding: 12px 14px; border: 1px solid #D9D9DD; border-radius: 6px; background: #F8F8FB;
}
.ld-status-label { font-size: 15px; font-weight: 700; }
.ld-status-meta { font-size: 13px; color: #595959; margin-top: 2px; }
.ld-form { display: grid; gap: 6px; }
.ld-form label { font-size: 13px; font-weight: 600; color: #595959; }
.ld-form input {
  width: 100%; box-sizing: border-box;
  border: 1px solid #D9D9DD; border-radius: 6px;
  padding: 10px 12px; font-size: 14px; color: #1A1A1C; background: #fff;
}
.ld-form input:focus { outline: none; border-color: #0017C1; box-shadow: 0 0 0 2px rgba(0,23,193,.15); }
.ld-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ld-btn {
  min-height: 44px; padding: 0 16px;
  border: 1px solid #D9D9DD; border-radius: 6px;
  background: #fff; color: #1A1A1C; font-size: 14px; font-weight: 500;
  cursor: pointer;
}
.ld-btn:hover { background: #F8F8FB; }
.ld-btn-primary {
  min-height: 44px; padding: 0 20px;
  border: none; border-radius: 6px;
  background: #b0302f; color: #fff; font-size: 14px; font-weight: 700;
  cursor: pointer;
}
.ld-btn-primary:hover { background: #8c2625; }
.ld-link {
  border: none; background: none; padding: 0;
  color: #b0302f; font-size: 13px; cursor: pointer;
}
.ld-link:hover { text-decoration: underline; }
.ld-message { min-height: 1.4em; font-size: 13px; color: #595959; line-height: 1.5; }

/* --- 設定パネル内 --- */
.akapen-license-settings-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-bottom: 14px;
}
.akapen-license-settings-status { font-size: 13px; color: #595959; }
.akapen-license-settings-row button {
  min-height: 36px; padding: 0 14px;
  border: 1px solid #D9D9DD; border-radius: 6px;
  background: #b0302f; color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer;
}

/* --- プラン比較ポップアップ --- */
.akapen-plan-popup { width: min(580px, calc(100vw - 32px)); }
.pp-body { padding: 20px 24px; }
.pp-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.pp-header h3 { margin: 0; font-size: 17px; font-weight: 700; }
.pp-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 13px; }
.pp-table th { padding: 10px 8px; text-align: center; font-weight: 700; font-size: 14px; color: #1A1A1C; border-bottom: 2px solid #b0302f; }
.pp-table th:first-child { text-align: left; color: #595959; font-size: 12px; font-weight: 600; }
.pp-table td { padding: 10px 8px; text-align: center; border-bottom: 1px solid #D9D9DD; vertical-align: middle; }
.pp-table td:first-child { text-align: left; font-size: 13px; color: #1A1A1C; }
.pp-check { color: #259D63; font-weight: 700; }
.pp-dash { color: #D9D9DD; }
.pp-note { font-size: 11px; color: #595959; font-style: italic; }
.pp-btn-cell { border-bottom: none !important; padding-top: 14px !important; }
.pp-buy {
  display: inline-block; min-height: 40px; padding: 0 16px;
  border: 1px solid #D9D9DD; border-radius: 6px;
  background: #fff; color: #1A1A1C; font-size: 13px; font-weight: 500;
  cursor: pointer; line-height: 40px;
}
.pp-buy:hover { background: #F8F8FB; }
.pp-buy-primary {
  display: inline-block; min-height: 40px; padding: 0 16px;
  border: none; border-radius: 6px;
  background: #b0302f; color: #fff; font-size: 13px; font-weight: 700;
  cursor: pointer; line-height: 40px;
}
.pp-buy-primary:hover { background: #8c2625; }
.pp-comment { font-size: 12px; color: #595959; line-height: 1.6; margin-top: 14px; }
.pp-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px; border-top: 1px solid #D9D9DD;
}

/* --- ライセンス詳細ポップアップ --- */
.akapen-license-detail-popup { width: min(500px, calc(100vw - 32px)); }
.ld-detail-body { padding: 20px 24px; }
.ld-detail-body h3 { margin: 0 0 12px; font-size: 17px; font-weight: 700; }
.ld-detail-body ul { margin: 0; padding-left: 20px; display: grid; gap: 10px; }
.ld-detail-body li { font-size: 13px; line-height: 1.6; color: #1A1A1C; }
.ld-detail-body li strong { font-weight: 600; }
.ld-detail-footer {
  display: flex; justify-content: flex-end;
  padding: 12px 24px; border-top: 1px solid #D9D9DD;
}
`;

export function createLicenseGate(client: LicenseClient): LicenseGateHandle {
  let latest: LicenseApiResult | null = null;
  let settingsStatusEl: HTMLElement | null = null;
  let settingsTitleEl: HTMLElement | null = null;
  let settingsButtonEl: HTMLButtonElement | null = null;

  // --- スタイル注入 ---
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // --- ライセンス管理ダイアログ ---
  const dialog = document.createElement('dialog');
  dialog.className = 'akapen-license-dialog';
  dialog.innerHTML = `
    <div class="ld-body">
      <div class="ld-header">
        <h2 data-role="license-title">${t('license.title')}</h2>
        <button type="button" class="ld-close" data-action="close" aria-label="${t('license.close')}">×</button>
      </div>
      <div class="ld-status">
        <div class="ld-status-label" data-role="status-label">Free</div>
        <div class="ld-status-meta" data-role="status-meta"></div>
      </div>
      <div class="ld-form">
        <label for="akapen-license-key" data-role="license-key-label">${t('license.key')}</label>
        <input id="akapen-license-key" type="text" autocomplete="off" spellcheck="false" placeholder="AKAPEN-XXXX-XXXX-XXXX" data-role="license-key">
      </div>
      <div class="ld-actions">
        <button type="button" class="ld-btn-primary" data-action="activate">${t('license.activate')}</button>
        <button type="button" class="ld-btn" data-action="deactivate">${t('license.deactivate')}</button>
      </div>
      <div>
        <button type="button" class="ld-link" data-action="compare">${t('license.compare')}</button>
      </div>
      <div class="ld-message" data-role="message"></div>
    </div>
  `;
  document.body.appendChild(dialog);

  const q = <T extends HTMLElement>(sel: string): T => {
    const el = dialog.querySelector<T>(sel);
    if (!el) throw new Error(`license-gate: ${sel} not found`);
    return el;
  };

  const statusLabelEl = q<HTMLDivElement>('[data-role="status-label"]');
  const statusMetaEl = q<HTMLDivElement>('[data-role="status-meta"]');
  const messageEl = q<HTMLDivElement>('[data-role="message"]');
  const keyEl = q<HTMLInputElement>('[data-role="license-key"]');

  const setMessage = (msg: string) => { messageEl.textContent = msg; };

  const render = () => {
    const label = latest ? labelFor(latest) : 'Free';
    statusLabelEl.textContent = label;
    statusMetaEl.textContent = metaFor(latest);
    if (settingsStatusEl) settingsStatusEl.textContent = label;
  };

  const applyResult = (result: LicenseApiResult) => {
    latest = result;
    render();
    if (result.status === 'error') setMessage(result.message);
  };

  const refresh = async () => {
    setMessage('');
    applyResult(await client.status());
  };

  q<HTMLButtonElement>('[data-action="close"]').addEventListener('click', () => dialog.close());

  q<HTMLButtonElement>('[data-action="activate"]').addEventListener('click', () => {
    const key = keyEl.value.trim();
    if (!key) { setMessage(t('license.enterKey')); return; }
    void client.activate(key).then((result) => {
      applyResult(result);
      if (result.status === 'ok') { keyEl.value = ''; setMessage(t('license.activated')); }
    });
  });

  q<HTMLButtonElement>('[data-action="deactivate"]').addEventListener('click', () => {
    void client.deactivate().then((result) => {
      applyResult(result);
      if (result.status === 'ok') setMessage(t('license.deactivated'));
    });
  });

  // --- プラン比較ポップアップ ---
  const planPopup = document.createElement('dialog');
  planPopup.className = 'akapen-plan-popup';
  planPopup.innerHTML = `
    <div class="pp-body">
      <div class="pp-header">
        <h3 data-role="plan-title">${t('license.planComparison')}</h3>
        <button type="button" class="ld-close" data-action="pp-close" aria-label="${t('license.close')}">×</button>
      </div>
      <table class="pp-table">
        <thead>
          <tr><th></th><th>Free</th><th>Standard</th><th>Supporter</th></tr>
        </thead>
        <tbody>
          <tr>
            <td data-role="plan-basic">${t('license.basicFeatures')}</td>
            <td class="pp-check">✓</td>
            <td class="pp-check">✓</td>
            <td class="pp-check">✓</td>
          </tr>
          <tr>
            <td data-role="plan-usage">${t('license.usage')}</td>
            <td data-role="plan-personal">${t('license.personalHobby')}</td>
            <td data-role="plan-standard-commercial">${t('license.commercialOk')}</td>
            <td data-role="plan-supporter-commercial">${t('license.commercialOk')}</td>
          </tr>
          <tr>
            <td data-role="plan-updates">${t('license.futureUpdates')}</td>
            <td class="pp-dash">—</td>
            <td class="pp-check">✓</td>
            <td class="pp-check">✓</td>
          </tr>
          <tr>
            <td data-role="plan-devices">${t('license.deviceCount')}</td>
            <td class="pp-dash">—</td>
            <td data-role="plan-two-devices">${t('license.twoDevices')}</td>
            <td data-role="plan-four-devices">${t('license.fourDevices')}</td>
          </tr>
          <tr>
            <td class="pp-btn-cell"></td>
            <td class="pp-btn-cell"></td>
            <td class="pp-btn-cell"><button type="button" class="pp-buy-primary" data-action="buy-standard">${t('license.buy')}</button></td>
            <td class="pp-btn-cell"><button type="button" class="pp-buy-primary" data-action="buy-supporter">${t('license.buy')}</button></td>
          </tr>
        </tbody>
      </table>
      <p class="pp-comment" data-role="plan-note">${t('license.planNote')}</p>
    </div>
    <div class="pp-footer">
      <button type="button" class="ld-link" data-action="show-license-detail">${t('license.detailsLink')}</button>
    </div>
  `;
  document.body.appendChild(planPopup);
  const openPlanComparison = () => {
    if (!planPopup.open) planPopup.showModal();
  };

  // --- プレミアム機能ゲートダイアログ（プラン比較の前に表示） ---
  const gateDialog = document.createElement('dialog');
  gateDialog.className = 'akapen-license-detail-popup';
  gateDialog.innerHTML = `
    <div class="ld-detail-body">
      <div class="pp-header">
        <h3 data-role="gate-title"></h3>
        <button type="button" class="ld-close" data-action="gate-close" aria-label="${t('premium.featureGateCancel')}">×</button>
      </div>
      <p style="font-size:14px;line-height:1.6;color:var(--ink,#1A1A1C);margin:0 0 16px;" data-role="gate-detail"></p>
      <div class="ld-actions">
        <button type="button" class="ld-btn-primary" data-action="gate-view-plans"></button>
        <button type="button" class="ld-btn" data-action="gate-cancel"></button>
      </div>
    </div>
  `;
  document.body.appendChild(gateDialog);

  const gateTitle = gateDialog.querySelector<HTMLElement>('[data-role="gate-title"]')!;
  const gateDetail = gateDialog.querySelector<HTMLElement>('[data-role="gate-detail"]')!;
  const gateViewPlans = gateDialog.querySelector<HTMLButtonElement>('[data-action="gate-view-plans"]')!;
  const gateCancel = gateDialog.querySelector<HTMLButtonElement>('[data-action="gate-cancel"]')!;
  const gateClose = gateDialog.querySelector<HTMLButtonElement>('[data-action="gate-close"]')!;
  let gateFeature: PremiumFeature = 'tabs';

  const updateGateText = (feature: PremiumFeature = gateFeature) => {
    gateFeature = feature;
    gateTitle.textContent = t('premium.featureGateTitle');
    gateDetail.textContent = t(premiumFeatureDetailKey(gateFeature));
    gateViewPlans.textContent = t('premium.featureGateViewPlans');
    gateCancel.textContent = t('premium.featureGateCancel');
    gateClose.ariaLabel = t('premium.featureGateCancel');
  };
  updateGateText();

  gateViewPlans.addEventListener('click', () => {
    gateDialog.close();
    openPlanComparison();
  });
  gateCancel.addEventListener('click', () => gateDialog.close());
  gateClose.addEventListener('click', () => gateDialog.close());
  gateDialog.addEventListener('cancel', () => gateDialog.close());

  window.addEventListener('akapen:premium-required', (event) => {
    const feature =
      event instanceof CustomEvent ? normalizePremiumFeature(event.detail?.feature) : 'tabs';
    updateGateText(feature);
    if (!gateDialog.open) gateDialog.showModal();
  });

  planPopup.querySelector('[data-action="pp-close"]')!.addEventListener('click', () => planPopup.close());
  planPopup.querySelector('[data-action="buy-standard"]')!.addEventListener('click', () => {
    window.open(CHECKOUT_URL_STANDARD, '_blank', 'noopener');
  });
  planPopup.querySelector('[data-action="buy-supporter"]')!.addEventListener('click', () => {
    window.open(CHECKOUT_URL_SUPPORTER, '_blank', 'noopener');
  });
  planPopup.addEventListener('cancel', () => planPopup.close());

  q<HTMLButtonElement>('[data-action="compare"]').addEventListener('click', openPlanComparison);

  // --- ライセンス詳細ポップアップ ---
  const detailPopup = document.createElement('dialog');
  detailPopup.className = 'akapen-license-detail-popup';
  detailPopup.innerHTML = `
    <div class="ld-detail-body">
      <div class="pp-header">
        <h3 data-role="detail-title">${t('license.details')}</h3>
        <button type="button" class="ld-close" data-action="detail-close" aria-label="${t('license.close')}">×</button>
      </div>
      <ul data-role="detail-list">
        <li><strong>${t('license.personalUseTitle')}</strong><br>${t('license.personalUseBody')}</li>
        <li><strong>${t('license.commercialUseTitle')}</strong><br>${t('license.commercialUseBody')}</li>
        <li><strong>${t('license.onePersonTitle')}</strong><br>${t('license.onePersonBody')}</li>
        <li><strong>${t('license.noRedistributionTitle')}</strong><br>${t('license.noRedistributionBody')}</li>
      </ul>
    </div>
  `;
  document.body.appendChild(detailPopup);

  detailPopup.querySelector('[data-action="detail-close"]')!.addEventListener('click', () => detailPopup.close());
  detailPopup.addEventListener('cancel', () => detailPopup.close());

  planPopup.querySelector('[data-action="show-license-detail"]')!.addEventListener('click', () => {
    detailPopup.showModal();
  });

  const pq = <T extends HTMLElement>(sel: string): T => {
    const el = planPopup.querySelector<T>(sel);
    if (!el) throw new Error(`license-plan: ${sel} not found`);
    return el;
  };
  const dq = <T extends HTMLElement>(sel: string): T => {
    const el = detailPopup.querySelector<T>(sel);
    if (!el) throw new Error(`license-detail: ${sel} not found`);
    return el;
  };
  const renderStaticText = () => {
    q<HTMLHeadingElement>('[data-role="license-title"]').textContent = t('license.title');
    q<HTMLButtonElement>('[data-action="close"]').setAttribute('aria-label', t('license.close'));
    q<HTMLLabelElement>('[data-role="license-key-label"]').textContent = t('license.key');
    q<HTMLButtonElement>('[data-action="activate"]').textContent = t('license.activate');
    q<HTMLButtonElement>('[data-action="deactivate"]').textContent = t('license.deactivate');
    q<HTMLButtonElement>('[data-action="compare"]').textContent = t('license.compare');
    pq<HTMLHeadingElement>('[data-role="plan-title"]').textContent = t('license.planComparison');
    pq<HTMLButtonElement>('[data-action="pp-close"]').setAttribute('aria-label', t('license.close'));
    pq<HTMLTableCellElement>('[data-role="plan-basic"]').textContent = t('license.basicFeatures');
    pq<HTMLTableCellElement>('[data-role="plan-usage"]').textContent = t('license.usage');
    pq<HTMLTableCellElement>('[data-role="plan-personal"]').textContent = t('license.personalHobby');
    pq<HTMLTableCellElement>('[data-role="plan-standard-commercial"]').textContent = t('license.commercialOk');
    pq<HTMLTableCellElement>('[data-role="plan-supporter-commercial"]').textContent = t('license.commercialOk');
    pq<HTMLTableCellElement>('[data-role="plan-updates"]').textContent = t('license.futureUpdates');
    pq<HTMLTableCellElement>('[data-role="plan-devices"]').textContent = t('license.deviceCount');
    pq<HTMLTableCellElement>('[data-role="plan-two-devices"]').textContent = t('license.twoDevices');
    pq<HTMLTableCellElement>('[data-role="plan-four-devices"]').textContent = t('license.fourDevices');
    pq<HTMLButtonElement>('[data-action="buy-standard"]').textContent = t('license.buy');
    pq<HTMLButtonElement>('[data-action="buy-supporter"]').textContent = t('license.buy');
    pq<HTMLParagraphElement>('[data-role="plan-note"]').innerHTML = t('license.planNote');
    pq<HTMLButtonElement>('[data-action="show-license-detail"]').textContent = t('license.detailsLink');
    dq<HTMLHeadingElement>('[data-role="detail-title"]').textContent = t('license.details');
    dq<HTMLButtonElement>('[data-action="detail-close"]').setAttribute('aria-label', t('license.close'));
    dq<HTMLUListElement>('[data-role="detail-list"]').innerHTML = [
      `<li><strong>${t('license.personalUseTitle')}</strong><br>${t('license.personalUseBody')}</li>`,
      `<li><strong>${t('license.commercialUseTitle')}</strong><br>${t('license.commercialUseBody')}</li>`,
      `<li><strong>${t('license.onePersonTitle')}</strong><br>${t('license.onePersonBody')}</li>`,
      `<li><strong>${t('license.noRedistributionTitle')}</strong><br>${t('license.noRedistributionBody')}</li>`,
    ].join('');
    updateGateText();
    if (settingsTitleEl) settingsTitleEl.textContent = t('license.title');
    if (settingsButtonEl) settingsButtonEl.textContent = t('license.manage');
    render();
  };
  onLanguageChange(renderStaticText);

  return {
    element: dialog,
    attachToSettingsPanel() {
      if (document.querySelector('[data-role="akapen-license-settings"]')) return;
      const card = document.querySelector<HTMLElement>('.akapen-shortcuts-panel__card');
      if (!card) return;
      const sep = document.createElement('div');
      sep.className = 'akapen-shortcuts-panel__sep';
      sep.dataset.role = 'akapen-license-settings';
      const title = document.createElement('div');
      title.className = 'akapen-shortcuts-panel__section-title';
      title.dataset.role = 'akapen-license-settings';
      title.textContent = t('license.title');
      settingsTitleEl = title;
      const row = document.createElement('div');
      row.className = 'akapen-license-settings-row';
      row.dataset.role = 'akapen-license-settings';
      settingsStatusEl = document.createElement('span');
      settingsStatusEl.className = 'akapen-license-settings-status';
      settingsStatusEl.textContent = latest ? labelFor(latest) : 'Free';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = t('license.manage');
      settingsButtonEl = button;
      button.addEventListener('click', () => {
        if (!dialog.open) dialog.showModal();
        void refresh();
      });
      row.append(settingsStatusEl, button);
      const languageSection = card.querySelector<HTMLElement>('[data-role="language-settings"]');
      if (languageSection) {
        card.insertBefore(sep, languageSection);
        card.insertBefore(title, languageSection);
        card.insertBefore(row, languageSection);
      } else {
        card.appendChild(sep);
        card.appendChild(title);
        card.appendChild(row);
      }
    },
    open() {
      if (!dialog.open) dialog.showModal();
      void refresh();
      keyEl.focus();
    },
    openPlanComparison,
    refresh,
  };
}

function labelFor(result: LicenseApiResult): string {
  if (result.status === 'error') return t('license.unlicensed');
  if (result.license.licensed && result.license.plan === 'supporter') return 'Supporter';
  if (result.license.licensed && result.license.plan === 'standard') return 'Standard';
  if (result.license.plan === 'free') return 'Free';
  return t('license.unlicensed');
}

function metaFor(result: LicenseApiResult | null): string {
  if (!result) return '';
  if (result.status === 'error') return result.message;
  const { activationId, lastValidated } = result.license;
  if (!activationId) return t('license.freeMeta');
  const validated = lastValidated ? t('license.lastChecked', { date: fmtDate(lastValidated) }) : t('license.notChecked');
  return validated;
}

function isHttpUrl(value: string): boolean {
  try { return new URL(value).protocol.startsWith('http'); } catch { return false; }
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}
