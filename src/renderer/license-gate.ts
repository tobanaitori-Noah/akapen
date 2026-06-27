import type { LicenseApiResult } from './bridge-web';

const CHECKOUT_URL_STANDARD = 'https://buy.polar.sh/polar_cl_elVIqlJG60KiZ6ApP4b5hd7JYVjyHPfGs5MFE14ytSU';
const CHECKOUT_URL_SUPPORTER = 'https://buy.polar.sh/polar_cl_VpJIdymnwMcXL6BCFPAXWZVDuveWPKvRjQDdH0LBigX';

type LicenseClient = {
  status(): Promise<LicenseApiResult>;
  activate(key: string): Promise<LicenseApiResult>;
  deactivate(): Promise<LicenseApiResult>;
};

export interface LicenseGateHandle {
  element: HTMLDialogElement;
  attachToSettingsPanel(): void;
  open(): void;
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
        <h2>ライセンス</h2>
        <button type="button" class="ld-close" data-action="close" aria-label="閉じる">×</button>
      </div>
      <div class="ld-status">
        <div class="ld-status-label" data-role="status-label">Free</div>
        <div class="ld-status-meta" data-role="status-meta"></div>
      </div>
      <div class="ld-form">
        <label for="akapen-license-key">ライセンスキー</label>
        <input id="akapen-license-key" type="text" autocomplete="off" spellcheck="false" placeholder="AKAPEN-XXXX-XXXX-XXXX" data-role="license-key">
      </div>
      <div class="ld-actions">
        <button type="button" class="ld-btn-primary" data-action="activate">認証する</button>
        <button type="button" class="ld-btn" data-action="deactivate">解除</button>
      </div>
      <div>
        <button type="button" class="ld-link" data-action="compare">プランを比較</button>
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
    if (!key) { setMessage('ライセンスキーを入力してください。'); return; }
    void client.activate(key).then((result) => {
      applyResult(result);
      if (result.status === 'ok') { keyEl.value = ''; setMessage('ライセンスを認証しました。'); }
    });
  });

  q<HTMLButtonElement>('[data-action="deactivate"]').addEventListener('click', () => {
    void client.deactivate().then((result) => {
      applyResult(result);
      if (result.status === 'ok') setMessage('ライセンスを解除しました。');
    });
  });

  // --- プラン比較ポップアップ ---
  const planPopup = document.createElement('dialog');
  planPopup.className = 'akapen-plan-popup';
  planPopup.innerHTML = `
    <div class="pp-body">
      <div class="pp-header">
        <h3>プラン比較</h3>
        <button type="button" class="ld-close" data-action="pp-close" aria-label="閉じる">×</button>
      </div>
      <table class="pp-table">
        <thead>
          <tr><th></th><th>Free</th><th>Standard</th><th>Supporter</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>基本機能</td>
            <td class="pp-check">✓</td>
            <td class="pp-check">✓</td>
            <td class="pp-check">✓</td>
          </tr>
          <tr>
            <td>利用範囲</td>
            <td>個人・趣味</td>
            <td>商用OK</td>
            <td>商用OK</td>
          </tr>
          <tr>
            <td>今後の機能更新・追加機能</td>
            <td class="pp-dash">—</td>
            <td class="pp-check">✓</td>
            <td class="pp-check">✓</td>
          </tr>
          <tr>
            <td>同時利用デバイス数</td>
            <td class="pp-dash">—</td>
            <td>2台</td>
            <td>4台</td>
          </tr>
          <tr>
            <td class="pp-btn-cell"></td>
            <td class="pp-btn-cell"></td>
            <td class="pp-btn-cell"><button type="button" class="pp-buy-primary" data-action="buy-standard">購入する</button></td>
            <td class="pp-btn-cell"><button type="button" class="pp-buy-primary" data-action="buy-supporter">購入する</button></td>
          </tr>
        </tbody>
      </table>
      <p class="pp-comment">Standard と Supporter の機能的な内容は同じです。<br>同時利用デバイス数のみ異なります。<br><br>Supporter プランで、開発者をぜひ応援していただけると嬉しいです。</p>
    </div>
    <div class="pp-footer">
      <button type="button" class="ld-link" data-action="show-license-detail">ⓘ ライセンス詳細</button>
    </div>
  `;
  document.body.appendChild(planPopup);

  planPopup.querySelector('[data-action="pp-close"]')!.addEventListener('click', () => planPopup.close());
  planPopup.querySelector('[data-action="buy-standard"]')!.addEventListener('click', () => {
    window.open(CHECKOUT_URL_STANDARD, '_blank', 'noopener');
  });
  planPopup.querySelector('[data-action="buy-supporter"]')!.addEventListener('click', () => {
    window.open(CHECKOUT_URL_SUPPORTER, '_blank', 'noopener');
  });
  planPopup.addEventListener('cancel', () => planPopup.close());

  q<HTMLButtonElement>('[data-action="compare"]').addEventListener('click', () => planPopup.showModal());

  // --- ライセンス詳細ポップアップ ---
  const detailPopup = document.createElement('dialog');
  detailPopup.className = 'akapen-license-detail-popup';
  detailPopup.innerHTML = `
    <div class="ld-detail-body">
      <div class="pp-header">
        <h3>ライセンス詳細</h3>
        <button type="button" class="ld-close" data-action="detail-close" aria-label="閉じる">×</button>
      </div>
      <ul>
        <li><strong>個人の趣味・非営利での利用</strong><br>Free プランで OK です。無料でご利用いただけます。</li>
        <li><strong>仕事や商用での利用</strong><br>収益につながる用途では、Standard プラン以上のライセンス購入をお願いします。</li>
        <li><strong>1人1ライセンス</strong><br>他の人への譲渡や共有は NG です。</li>
        <li><strong>再配布禁止</strong><br>AkaPen のコピーを他の人に配布したり、別のサービスに組み込んで提供することは NG です。</li>
      </ul>
    </div>
  `;
  document.body.appendChild(detailPopup);

  detailPopup.querySelector('[data-action="detail-close"]')!.addEventListener('click', () => detailPopup.close());
  detailPopup.addEventListener('cancel', () => detailPopup.close());

  planPopup.querySelector('[data-action="show-license-detail"]')!.addEventListener('click', () => {
    detailPopup.showModal();
  });

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
      title.textContent = 'ライセンス';
      const row = document.createElement('div');
      row.className = 'akapen-license-settings-row';
      row.dataset.role = 'akapen-license-settings';
      settingsStatusEl = document.createElement('span');
      settingsStatusEl.className = 'akapen-license-settings-status';
      settingsStatusEl.textContent = latest ? labelFor(latest) : 'Free';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '管理';
      button.addEventListener('click', () => {
        if (!dialog.open) dialog.showModal();
        void refresh();
      });
      row.append(settingsStatusEl, button);
      card.appendChild(sep);
      card.appendChild(title);
      card.appendChild(row);
    },
    open() {
      if (!dialog.open) dialog.showModal();
      void refresh();
      keyEl.focus();
    },
    refresh,
  };
}

function labelFor(result: LicenseApiResult): string {
  if (result.status === 'error') return '未認証';
  if (result.license.licensed && result.license.plan === 'supporter') return 'Supporter';
  if (result.license.licensed && result.license.plan === 'standard') return 'Standard';
  if (result.license.plan === 'free') return 'Free';
  return '未認証';
}

function metaFor(result: LicenseApiResult | null): string {
  if (!result) return '';
  if (result.status === 'error') return result.message;
  const { activationId, lastValidated } = result.license;
  if (!activationId) return 'v1.0 の機能は Free で利用できます。';
  const validated = lastValidated ? `最終確認: ${fmtDate(lastValidated)}` : '未確認';
  return validated;
}

function isHttpUrl(value: string): boolean {
  try { return new URL(value).protocol.startsWith('http'); } catch { return false; }
}

function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}
