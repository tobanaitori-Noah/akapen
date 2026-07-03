import type { AkapenBridge } from './bridge';
import type { LicenseStatus } from '../server/lib/license';
import { showChooseDialog, showConfirmDialog, showErrorDialog } from './dialogs';
import { showFilePicker, showSaveLocationPicker } from './file-picker';
import { t } from './i18n';

type OpenPayload = Parameters<Parameters<AkapenBridge['onOpenFile']>[0]>[0];
type BaseChangedPayload = Parameters<Parameters<AkapenBridge['onBaseChanged']>[0]>[0];
type WebBridge = AkapenBridge & {
  _handleInitialFile(payload: OpenPayload): void;
};
export type LicenseApiResult =
  | { status: 'ok'; license: LicenseStatus; checkoutUrl: string }
  | { status: 'error'; message: string; checkoutUrl: string };

async function api<T>(apiPath: string, body?: unknown): Promise<T> {
  const res = await fetch(apiPath, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (typeof data.message === 'string') message = data.message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function createLicenseClient() {
  const notifyChanged = () => window.dispatchEvent(new CustomEvent('akapen:license-changed'));
  return {
    status: () => api<LicenseApiResult>('/api/license/status'),
    activate: async (key: string) => {
      const result = await api<LicenseApiResult>('/api/license/activate', { key });
      notifyChanged();
      return result;
    },
    deactivate: async () => {
      const result = await api<LicenseApiResult>('/api/license/deactivate', {});
      notifyChanged();
      return result;
    },
  };
}

export function createWebBridge(): WebBridge {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let currentBasePath: string | null = null;
  let premiumCache: { value: boolean; checkedAt: number } | null = null;
  window.addEventListener('akapen:license-changed', () => {
    premiumCache = null;
  });

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}`);
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as { type?: string; payload?: unknown };
    if (!msg.type) return;
    const cbs = listeners.get(msg.type);
    if (cbs) for (const cb of cbs) cb(msg.payload);
  });

  function subscribe<T>(type: string, cb: (payload: T) => void): () => void {
    if (!listeners.has(type)) listeners.set(type, new Set());
    const set = listeners.get(type)!;
    const wrapped = (payload: unknown) => cb(payload as T);
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  function remember(payload: OpenPayload): OpenPayload {
    currentBasePath = payload.path;
    return payload;
  }

  async function writeWithOverwrite(
    apiPath: string,
    body: Record<string, unknown>,
  ): Promise<
    | { status: 'saved'; path: string }
    | { status: 'cancelled' }
    | { status: 'error'; message: string }
  > {
    const first = await api<
      | { status: 'saved'; path: string }
      | { status: 'cancelled' }
      | { status: 'error'; message: string }
      | { status: 'exists'; path: string }
    >(apiPath, body);
    if (first.status !== 'exists') return first;
    const ok = await showConfirmDialog(t('dialog.overwriteConfirm'), first.path);
    if (!ok) return { status: 'cancelled' };
    return api(apiPath, { ...body, overwrite: true });
  }

  const bridge: WebBridge = {
    async openDialog() {
      const selectedPath = await showFilePicker();
      if (!selectedPath) return null;
      const result = await api<Awaited<ReturnType<AkapenBridge['readFile']>>>('/api/file/read', {
        path: selectedPath,
      });
      if (result.status === 'error') return null;
      return remember({ path: result.path, content: result.content, stat: result.stat });
    },
    async readFile(filePath) {
      const result = await api<Awaited<ReturnType<AkapenBridge['readFile']>>>('/api/file/read', {
        path: filePath,
      });
      if (result.status === 'ok') currentBasePath = result.path;
      return result;
    },
    writeReview(req) {
      return writeWithOverwrite('/api/review/write', req);
    },
    async saveReviewAs(req) {
      const selectedPath = await showSaveLocationPicker(currentBasePath);
      if (!selectedPath) return { status: 'cancelled' as const };
      return writeWithOverwrite('/api/review/save-as', {
        path: selectedPath,
        content: req.content,
      });
    },
    confirm: (req) => showConfirmDialog(req.message, req.detail),
    choose: (req) => showChooseDialog(req.message, req.detail, req.buttons, req.cancelId),
    showError: (req) => showErrorDialog(req.message, req.detail),
    autosave: {
      write: (entry) => api('/api/autosave/write', entry),
      read: (basePath) => api('/api/autosave/read', { basePath }),
      list: () => api('/api/autosave/list'),
      remove: (basePath) => api('/api/autosave/remove', { basePath }),
    },
    readShortcuts: () => api('/api/settings/shortcuts'),
    writeShortcuts: (settings) => api('/api/settings/shortcuts', settings),
    readSettings: () => api('/api/settings/app'),
    writeSettings: (settings) => api('/api/settings/app', settings),
    async isPremiumUnlocked() {
      const now = Date.now();
      if (premiumCache && now - premiumCache.checkedAt < 30_000) {
        return premiumCache.value;
      }
      const result = await api<LicenseApiResult>('/api/license/status');
      const value = result.status === 'ok' && result.license.licensed;
      premiumCache = { value, checkedAt: now };
      return value;
    },
    async setActiveFile(filePath) {
      currentBasePath = filePath;
      await api('/api/file/active', { path: filePath });
    },
    async closeFile(filePath) {
      if (currentBasePath === filePath) currentBasePath = null;
      await api('/api/file/close', { path: filePath });
    },
    async getPathForFile(file) {
      const result = await api<{ status: 'ok'; path: string } | { status: 'error'; message: string }>(
        '/api/file/drop',
        { name: file.name, content: await file.text() },
      );
      if (result.status === 'error') throw new Error(result.message);
      return result.path;
    },
    onOpenFile: (cb) => subscribe<OpenPayload>('open-file', cb),
    onBaseChanged: (cb) => subscribe<BaseChangedPayload>('base-changed', cb),
    onMenuOpen: () => () => undefined,
    onMenuSave: () => () => undefined,
    onMenuSaveAs: () => () => undefined,
    onMenuFontSize: () => () => undefined,
    onMenuOpenSettings: () => () => undefined,
    _handleInitialFile(payload) {
      const remembered = remember(payload);
      const cbs = listeners.get('open-file');
      if (cbs) for (const cb of cbs) cb(remembered);
    },
  };

  return bridge;
}
