/**
 * G4: 目次（TOC）スライドパネル。
 * - ツールバー右端「◀︎」ボタンで右側からスライドイン/アウト。
 * - H1〜H3 を階層インデント付きで表示。クリックで見出しへジャンプ。
 * - 開閉時は onToggle コールバックで app 側（paneSync/marginNotes）に通知。
 * - 表示専用＝元データ（workingMd / base）には一切書き込まない。
 */

export interface TocItem {
  level: number;
  text: string;
}

export interface TocPanelOptions {
  /** パネル開閉状態が変わった時（marginNotes.refresh / paneSync.refresh のため） */
  onToggle(open: boolean): void;
  /** アイテムクリック → 見出しジャンプ（index は setItems で渡した配列の添字） */
  onJump(index: number): void;
}

export interface TocPanelHandle {
  element: HTMLElement;
  /** パネルの開閉をトグルする（ツールバーボタンから呼ぶ） */
  toggle(): void;
  /** 外部から閉じる（クリックアウトサイド等） */
  close(): void;
  isOpen(): boolean;
  /** 見出し一覧の差し替え（同内容なら DOM 再構築しない） */
  setItems(items: TocItem[]): void;
}

export function createTocPanel(options: TocPanelOptions): TocPanelHandle {
  const element = document.createElement('aside');
  element.className = 'akapen-toc-panel';
  element.setAttribute('aria-label', '目次');
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML = `
    <div class="akapen-toc-panel__header">
      <span class="akapen-toc-panel__title">目次</span>
      <button type="button" class="akapen-toc-panel__close" aria-label="目次パネルを閉じる">✕</button>
    </div>
    <nav class="akapen-toc-panel__nav">
      <ul class="akapen-toc-panel__list" data-role="toc-list"></ul>
    </nav>
  `;

  const list = element.querySelector<HTMLUListElement>('[data-role="toc-list"]')!;
  const closeButton = element.querySelector<HTMLButtonElement>('.akapen-toc-panel__close')!;

  let open = false;
  let itemSignature = '';

  closeButton.addEventListener('click', () => {
    close();
  });

  function open_(): void {
    if (open) return;
    open = true;
    element.classList.add('is-open');
    element.setAttribute('aria-hidden', 'false');
    options.onToggle(true);
  }

  function close(): void {
    if (!open) return;
    open = false;
    element.classList.remove('is-open');
    element.setAttribute('aria-hidden', 'true');
    options.onToggle(false);
  }

  return {
    element,
    toggle() {
      if (open) close();
      else open_();
    },
    close,
    isOpen() {
      return open;
    },
    setItems(items) {
      const sig = items.map((i) => `${i.level}:${i.text}`).join('\0');
      if (sig === itemSignature) return;
      itemSignature = sig;
      list.textContent = '';
      items.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = `akapen-toc-item akapen-toc-item--h${item.level}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.text.trim() || '（空の見出し）';
        btn.addEventListener('click', () => {
          options.onJump(index);
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
    },
  };
}
