import { mountApp } from './app';
import { createLicenseClient, createWebBridge } from './bridge-web';
import { t } from './i18n';
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
          message: t('renderer.openFailed'),
          detail: data.path ? `${data.path}\n${data.message}` : data.message,
        });
        return;
      }
      bridge._handleInitialFile(data);
    },
  )
  .catch((error: unknown) => {
    void bridge.showError({
      message: t('renderer.initialFileFailed'),
      detail: error instanceof Error ? error.message : String(error),
    });
  });
