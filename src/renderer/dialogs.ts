import { t } from './i18n';

function createDialog(className = 'akapen-web-dialog'): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = className;
  const style = document.createElement('style');
  style.textContent = `
    .akapen-web-dialog {
      border: 1px solid #d7d7d7;
      border-radius: 8px;
      padding: 0;
      max-width: min(520px, calc(100vw - 32px));
      color: #222;
      box-shadow: 0 18px 60px rgba(0,0,0,.22);
    }
    .akapen-web-dialog::backdrop { background: rgba(0,0,0,.32); }
    .akapen-web-dialog form,
    .akapen-web-dialog-body {
      display: grid;
      gap: 14px;
      padding: 18px;
      min-width: min(420px, calc(100vw - 48px));
    }
    .akapen-web-dialog-title { font-weight: 700; line-height: 1.5; }
    .akapen-web-dialog-detail { white-space: pre-wrap; line-height: 1.6; color: #555; }
    .akapen-web-dialog-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .akapen-web-dialog button {
      border: 1px solid #cfcfcf;
      border-radius: 6px;
      padding: 7px 12px;
      background: #fff;
      color: #222;
      cursor: pointer;
    }
    .akapen-web-dialog button[data-primary="true"] {
      border-color: #b0302f;
      background: #b0302f;
      color: #fff;
    }
  `;
  dialog.appendChild(style);
  return dialog;
}

function appendTextBlock(parent: HTMLElement, className: string, text: string): void {
  const block = document.createElement('div');
  block.className = className;
  block.textContent = text;
  parent.appendChild(block);
}

export function showConfirmDialog(message: string, detail?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = createDialog();
    const form = document.createElement('form');
    form.method = 'dialog';
    appendTextBlock(form, 'akapen-web-dialog-title', message);
    if (detail) appendTextBlock(form, 'akapen-web-dialog-detail', detail);
    const actions = document.createElement('div');
    actions.className = 'akapen-web-dialog-actions';
    const cancel = document.createElement('button');
    cancel.value = 'cancel';
    cancel.textContent = t('dialog.cancel');
    const ok = document.createElement('button');
    ok.value = 'ok';
    ok.textContent = t('dialog.ok');
    ok.dataset.primary = 'true';
    ok.autofocus = true;
    actions.append(cancel, ok);
    form.appendChild(actions);
    dialog.appendChild(form);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

export function showChooseDialog(
  message: string,
  detail: string | undefined,
  buttons: string[],
  cancelId?: number,
): Promise<number> {
  return new Promise((resolve) => {
    const dialog = createDialog();
    const form = document.createElement('form');
    form.method = 'dialog';
    appendTextBlock(form, 'akapen-web-dialog-title', message);
    if (detail) appendTextBlock(form, 'akapen-web-dialog-detail', detail);
    const actions = document.createElement('div');
    actions.className = 'akapen-web-dialog-actions';
    buttons.forEach((label, index) => {
      const button = document.createElement('button');
      button.value = String(index);
      button.textContent = label;
      if (index === 0) {
        button.dataset.primary = 'true';
        button.autofocus = true;
      }
      actions.appendChild(button);
    });
    form.appendChild(actions);
    dialog.appendChild(form);
    dialog.addEventListener('cancel', (event) => {
      if (cancelId !== undefined) {
        event.preventDefault();
        dialog.close(String(cancelId));
      }
    });
    dialog.addEventListener('close', () => {
      const parsed = Number(dialog.returnValue);
      resolve(Number.isInteger(parsed) ? parsed : cancelId ?? 0);
      dialog.remove();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

export function showErrorDialog(message: string, detail?: string): Promise<void> {
  return new Promise((resolve) => {
    const dialog = createDialog();
    const form = document.createElement('form');
    form.method = 'dialog';
    appendTextBlock(form, 'akapen-web-dialog-title', message);
    if (detail) appendTextBlock(form, 'akapen-web-dialog-detail', detail);
    const actions = document.createElement('div');
    actions.className = 'akapen-web-dialog-actions';
    const ok = document.createElement('button');
    ok.value = 'ok';
    ok.textContent = t('dialog.ok');
    ok.dataset.primary = 'true';
    ok.autofocus = true;
    actions.appendChild(ok);
    form.appendChild(actions);
    dialog.appendChild(form);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
