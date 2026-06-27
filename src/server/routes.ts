import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type {
  AkapenSettings,
  AutosaveEntry,
  BaseStat,
  ReadFileResult,
  ShortcutSettings,
} from '../renderer/bridge.js';
import { createPathAllowlist } from './lib/allowlist.js';
import { listAutosaves, readAutosave, removeAutosave, writeAutosave } from './lib/autosave.js';
import {
  activateLicense,
  checkLicense,
  deactivateLicense,
  POLAR_CHECKOUT_URL_SUPPORTER,
} from './lib/license.js';
import { reviewPathFor } from './lib/paths.js';
import { createBaseWatcher, type BaseWatcher } from './lib/watch.js';
import { writeReviewContent } from './lib/write.js';

const MD_EXT = /\.(md|markdown)$/i;
const REVIEW_EXT = /\.akapen\.md$/i;
const INVALID_REQUEST = { status: 'error', message: '不正なリクエストです' } as const;
const EMPTY_SHORTCUT_SETTINGS: ShortcutSettings = { version: 1, bindings: {} };
const DEFAULT_APP_SETTINGS: AkapenSettings = { version: 1, fontSize: 100 };
const FONT_SIZE_MIN = 50;
const FONT_SIZE_MAX = 200;

export interface RoutesOptions {
  broadcast: (msg: object) => void;
  openPath?: string;
  userDataDir?: string;
}

export interface BrowseEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

export type AkapenRouter = Router & {
  close(): void;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export async function readBaseFile(
  filePath: string,
): Promise<{ path: string; content: string; stat: BaseStat }> {
  const buf = await fs.promises.readFile(filePath);
  const st = await fs.promises.stat(filePath);
  return {
    path: filePath,
    content: buf.toString('utf8'),
    stat: {
      sha256: createHash('sha256').update(buf).digest('hex'),
      mtimeMs: st.mtimeMs,
      size: st.size,
    },
  };
}

function normalizeReviewPath(selectedPath: string): string {
  if (REVIEW_EXT.test(selectedPath)) return selectedPath;
  if (/\.md$/i.test(selectedPath)) return `${selectedPath.slice(0, -3)}.akapen.md`;
  return `${selectedPath}.akapen.md`;
}

function writeJsonFile(target: string, value: unknown): { status: 'ok' } | { status: 'error'; message: string } {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: messageOf(error) };
  }
}

export function createRoutes(options: RoutesOptions): AkapenRouter {
  const router = Router() as AkapenRouter;
  const allowlist = createPathAllowlist();
  const browseAllowlist = createPathAllowlist();
  const browsedDirectories = new Set<string>();
  const userDataDir = options.userDataDir ?? path.join(os.homedir(), '.akapen');
  const autosaveDir = path.join(userDataDir, 'autosave');
  const shortcutsPath = path.join(userDataDir, 'shortcuts.json');
  const settingsPath = path.join(userDataDir, 'settings.json');

  let initialOpenPath: string | null = options.openPath ?? null;
  let currentWatcher: BaseWatcher | null = null;
  let currentBasePath: string | null = null;

  const adoptBase = (filePath: string): void => {
    allowlist.register(filePath);
    currentWatcher?.close();
    currentWatcher = createBaseWatcher(filePath, () => {
      options.broadcast({ type: 'base-changed', payload: { path: filePath } });
    });
    currentBasePath = filePath;
  };

  const readShortcutSettings = (): ShortcutSettings => {
    try {
      if (!fs.existsSync(shortcutsPath)) return EMPTY_SHORTCUT_SETTINGS;
      const parsed = JSON.parse(fs.readFileSync(shortcutsPath, 'utf8')) as unknown;
      if (
        isRecord(parsed) &&
        parsed.version === 1 &&
        isRecord(parsed.bindings)
      ) {
        const bindings: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed.bindings)) {
          if (typeof value === 'string') bindings[key] = value;
        }
        return { version: 1, bindings };
      }
    } catch {
      // broken settings fall back to defaults
    }
    return EMPTY_SHORTCUT_SETTINGS;
  };

  const writeShortcutSettings = (settings: ShortcutSettings) => {
    if (
      settings?.version !== 1 ||
      !isRecord(settings.bindings) ||
      !Object.values(settings.bindings).every((value) => typeof value === 'string')
    ) {
      return INVALID_REQUEST;
    }
    return writeJsonFile(shortcutsPath, settings);
  };

  const readAppSettings = (): AkapenSettings => {
    try {
      if (!fs.existsSync(settingsPath)) return DEFAULT_APP_SETTINGS;
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as unknown;
      if (isRecord(parsed) && parsed.version === 1 && typeof parsed.fontSize === 'number') {
        const fontSize = Math.round(parsed.fontSize);
        return {
          version: 1,
          fontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, fontSize)),
        };
      }
    } catch {
      // broken settings fall back to defaults
    }
    return DEFAULT_APP_SETTINGS;
  };

  const writeAppSettings = (settings: AkapenSettings) => {
    if (settings?.version !== 1 || typeof settings.fontSize !== 'number' || !Number.isFinite(settings.fontSize)) {
      return INVALID_REQUEST;
    }
    const clamped: AkapenSettings = {
      version: 1,
      fontSize: Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(settings.fontSize))),
    };
    return writeJsonFile(settingsPath, clamped);
  };

  const sendError = (res: Response, error: unknown): void => {
    res.json({ status: 'error', message: messageOf(error) });
  };

  router.post('/api/file/read', async (req: Request, res: Response<ReadFileResult>) => {
    const filePath = req.body?.path;
    if (typeof filePath !== 'string' || !MD_EXT.test(filePath)) {
      res.json({ status: 'error', message: '.md / .markdown ファイルのみ開けます' });
      return;
    }
    if (!allowlist.isAllowed(filePath) && !browseAllowlist.isAllowed(filePath)) {
      res.json({
        status: 'error',
        message:
          'このパスは読み込みを許可されていません（ファイルピッカー・ドラッグ＆ドロップ・CLI から開いてください）',
      });
      return;
    }
    try {
      const opened = await readBaseFile(filePath);
      adoptBase(opened.path);
      res.json({ status: 'ok', ...opened });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/file/drop', async (req, res) => {
    const name = req.body?.name;
    const content = req.body?.content;
    if (typeof name !== 'string' || typeof content !== 'string' || !MD_EXT.test(name)) {
      res.json({ status: 'error', message: '.md / .markdown ファイルのみ開けます' });
      return;
    }
    try {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'akapen-drop-'));
      const safeName = path.basename(name).replace(/^\.+/, '') || `${randomUUID()}.md`;
      const target = path.join(dir, safeName);
      await fs.promises.writeFile(target, content, 'utf8');
      allowlist.register(target);
      res.json({ status: 'ok', path: target });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/api/file/browse', async (req, res) => {
    const rawDir = typeof req.query.dir === 'string' ? req.query.dir : os.homedir();
    try {
      const cwd = path.resolve(rawDir);
      const names = await fs.promises.readdir(cwd, { withFileTypes: true });
      browsedDirectories.add(cwd);
      const parent = path.dirname(cwd);
      if (parent !== cwd) browsedDirectories.add(parent);
      const entries: BrowseEntry[] = [];
      for (const entry of names) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(cwd, entry.name);
        if (entry.isDirectory()) {
          entries.push({ name: entry.name, type: 'dir', path: fullPath });
          continue;
        }
        if (entry.isFile() && MD_EXT.test(entry.name)) {
          browseAllowlist.register(fullPath);
          entries.push({ name: entry.name, type: 'file', path: fullPath });
        }
      }
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ cwd, parent: parent === cwd ? null : parent, entries });
    } catch (error) {
      res.status(400).json({ status: 'error', message: messageOf(error) });
    }
  });

  router.post('/api/review/write', async (req, res) => {
    const { basePath, content, overwrite } = req.body ?? {};
    if (typeof basePath !== 'string' || typeof content !== 'string') {
      res.json(INVALID_REQUEST);
      return;
    }
    if (!allowlist.isAllowed(basePath)) {
      res.json({
        status: 'error',
        message: 'このファイルへの保存は許可されていません（開いたファイルの隣にのみ保存できます）',
      });
      return;
    }
    const target = reviewPathFor(basePath);
    if (fs.existsSync(target) && overwrite !== true) {
      res.json({ status: 'exists', path: target });
      return;
    }
    res.json(writeReviewContent(target, content));
  });

  router.post('/api/review/save-as', async (req, res) => {
    const { path: selectedPath, content, overwrite } = req.body ?? {};
    if (typeof selectedPath !== 'string' || typeof content !== 'string') {
      res.json(INVALID_REQUEST);
      return;
    }
    const target = normalizeReviewPath(selectedPath);
    const parent = path.dirname(target);
    if (!browsedDirectories.has(parent)) {
      res.json({
        status: 'error',
        message: 'この保存先はファイルピッカーで選択されていません',
      });
      return;
    }
    if (fs.existsSync(target) && overwrite !== true) {
      res.json({ status: 'exists', path: target });
      return;
    }
    res.json(writeReviewContent(target, content));
  });

  router.post('/api/autosave/write', (req, res) => {
    const entry = req.body as AutosaveEntry;
    if (!isRecord(entry)) {
      res.json(INVALID_REQUEST);
      return;
    }
    if (
      entry.version !== 2 ||
      typeof entry.basePath !== 'string' ||
      typeof entry.baseOriginal !== 'string' ||
      typeof entry.baseRaw !== 'string' ||
      typeof entry.globalNote !== 'string' ||
      typeof entry.savedAt !== 'string' ||
      !Array.isArray(entry.operations) ||
      !Array.isArray(entry.redoStack) ||
      !isRecord(entry.baseStat) ||
      typeof entry.baseStat.sha256 !== 'string' ||
      typeof entry.baseStat.mtimeMs !== 'number' ||
      typeof entry.baseStat.size !== 'number'
    ) {
      res.json(INVALID_REQUEST);
      return;
    }
    if (!allowlist.isAllowed(entry.basePath)) {
      res.json({ status: 'error', message: 'この basePath への自動保存は許可されていません' });
      return;
    }
    res.json(writeAutosave(autosaveDir, entry));
  });

  router.post('/api/autosave/read', (req, res) => {
    const basePath = req.body?.basePath;
    if (typeof basePath !== 'string') {
      res.json(INVALID_REQUEST);
      return;
    }
    try {
      res.json(readAutosave(autosaveDir, basePath));
    } catch (error) {
      res.json({ status: 'error', message: messageOf(error) });
    }
  });

  router.get('/api/autosave/list', (_req, res) => {
    const result = listAutosaves(autosaveDir);
    if (result.status === 'ok') {
      for (const item of result.items) allowlist.register(item.basePath);
    }
    res.json(result);
  });

  router.post('/api/autosave/remove', (req, res) => {
    const basePath = req.body?.basePath;
    if (typeof basePath !== 'string') {
      res.json(INVALID_REQUEST);
      return;
    }
    res.json(removeAutosave(autosaveDir, basePath));
  });

  router.get('/api/settings/shortcuts', (_req, res) => res.json(readShortcutSettings()));
  router.post('/api/settings/shortcuts', (req, res) =>
    res.json(writeShortcutSettings(req.body as ShortcutSettings)),
  );
  router.get('/api/settings/app', (_req, res) => res.json(readAppSettings()));
  router.post('/api/settings/app', (req, res) =>
    res.json(writeAppSettings(req.body as AkapenSettings)),
  );

  router.get('/api/license/status', async (_req, res) => {
    try {
      res.json({
        status: 'ok',
        license: await checkLicense({ userDataDir }),
        checkoutUrl: POLAR_CHECKOUT_URL_SUPPORTER,
      });
    } catch (error) {
      res.json({ status: 'error', message: messageOf(error), checkoutUrl: POLAR_CHECKOUT_URL_SUPPORTER });
    }
  });

  router.post('/api/license/activate', async (req, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string') {
      res.json(INVALID_REQUEST);
      return;
    }
    try {
      res.json({
        status: 'ok',
        license: await activateLicense(key, { userDataDir }),
        checkoutUrl: POLAR_CHECKOUT_URL_SUPPORTER,
      });
    } catch (error) {
      res.json({ status: 'error', message: messageOf(error), checkoutUrl: POLAR_CHECKOUT_URL_SUPPORTER });
    }
  });

  router.post('/api/license/deactivate', async (_req, res) => {
    try {
      res.json({
        status: 'ok',
        license: await deactivateLicense({ userDataDir }),
        checkoutUrl: POLAR_CHECKOUT_URL_SUPPORTER,
      });
    } catch (error) {
      res.json({ status: 'error', message: messageOf(error), checkoutUrl: POLAR_CHECKOUT_URL_SUPPORTER });
    }
  });

  router.get('/api/initial-file', async (_req, res) => {
    if (!initialOpenPath) {
      res.json(null);
      return;
    }
    const filePath = initialOpenPath;
    initialOpenPath = null;
    try {
      const opened = await readBaseFile(filePath);
      adoptBase(opened.path);
      res.json(opened);
    } catch (error) {
      res.json({ status: 'error', message: messageOf(error), path: filePath });
    }
  });

  router.get('/api/review/default-path', (_req, res) => {
    res.json({ path: currentBasePath ? reviewPathFor(currentBasePath) : null });
  });

  router.close = () => {
    currentWatcher?.close();
    currentWatcher = null;
  };

  return router;
}
