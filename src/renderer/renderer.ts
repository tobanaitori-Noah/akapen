import { mountApp } from './app';
import { createLicenseClient, createWebBridge } from './bridge-web';
import { createLicenseGate } from './license-gate';

const bridge = createWebBridge();
window.akapen = bridge;
mountApp(document.body, bridge);
const licenseGate = createLicenseGate(createLicenseClient());
document.body.appendChild(licenseGate.element);
licenseGate.attachToSettingsPanel();
void licenseGate.refresh();

void fetch('/api/initial-file')
  .then((res) => res.json())
  .then(
    (
      data:
        | { path: string; content: string; stat: import('./bridge').BaseStat }
        | { status: 'error'; message: string; path?: string }
        | null,
    ) => {
      if (!data) return;
      if ('status' in data) {
        void bridge.showError({
          message: 'ファイルを開けませんでした',
          detail: data.path ? `${data.path}\n${data.message}` : data.message,
        });
        return;
      }
      bridge._handleInitialFile(data);
    },
  )
  .catch((error: unknown) => {
    void bridge.showError({
      message: '初回ファイルの読み込みに失敗しました',
      detail: error instanceof Error ? error.message : String(error),
    });
  });
