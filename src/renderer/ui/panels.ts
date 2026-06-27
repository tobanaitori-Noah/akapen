/**
 * 完了パネル＝計画2 Task 8 Step 1（完了ハンドラ 5.）。
 * 保存パス＋次に使うAIへ渡すための案内文＋コピー用ボタン。
 * レビュー中に base が外部変更されていた場合（ガード③）は注記を添える。
 */

export interface CompletionPanelHandle {
  element: HTMLElement;
  show(opts: { savedPath: string; baseChangedExternally: boolean }): void;
  hide(): void;
}

export function createCompletionPanel(): CompletionPanelHandle {
  const element = document.createElement('div');
  element.className = 'akapen-complete-panel is-hidden';
  element.innerHTML = `
    <div class="akapen-complete-panel__card">
      <h2>レビューを書き出しました</h2>
      <p class="akapen-complete-panel__path" data-role="saved-path"></p>
      <button type="button" data-action="copy-path">パスをコピー</button>
      <p>次に使うAIへ、レビューを書き出したことを伝えてください。</p>
      <p class="akapen-complete-panel__message" data-role="handoff-message"></p>
      <button type="button" data-action="copy-handoff-message">メッセージをコピー</button>
      <p class="akapen-complete-panel__note is-hidden" data-role="base-changed-note">
        注記: 元データのファイルはレビュー中に外部で変更されています。このレビューは開いた時点の内容が基準です。
      </p>
      <button type="button" data-action="panel-close">閉じる</button>
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

  query<HTMLButtonElement>('[data-action="copy-path"]').addEventListener('click', () => {
    void navigator.clipboard.writeText(pathEl.textContent ?? '');
  });
  query<HTMLButtonElement>('[data-action="copy-handoff-message"]').addEventListener('click', () => {
    void navigator.clipboard.writeText(messageEl.textContent ?? '');
  });
  query<HTMLButtonElement>('[data-action="panel-close"]').addEventListener('click', () => {
    element.classList.add('is-hidden');
  });

  return {
    element,
    show({ savedPath, baseChangedExternally }) {
      pathEl.textContent = savedPath;
      messageEl.textContent =
        `AkaPenでレビューを書き出しました。` +
        `レビュー結果は次のファイルにあります: ${savedPath}\n` +
        `このファイルには、本文への添削、追記、削除提案、コメントや感想が含まれています。内容を確認してください。`;
      noteEl.classList.toggle('is-hidden', !baseChangedExternally);
      element.classList.remove('is-hidden');
    },
    hide() {
      element.classList.add('is-hidden');
    },
  };
}
