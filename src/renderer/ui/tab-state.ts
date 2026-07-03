import type { AkapenBridge, AutosaveEntry, BaseStat } from '../bridge';
import type { AppState, ViewMode } from '../state';
import { t } from '../i18n';
import type { ReviewAnnotation } from '../review-model/index';
import type { TabBarItem } from './tab-bar';

export const MAX_TABS = 10;

export interface TabPayload {
  path: string;
  content: string;
  stat: BaseStat;
}

export interface TabSession {
  id: string;
  payload: TabPayload | null;
  title: string;
  restore: AutosaveEntry | null;
  workingMarkdown: string | null;
  viewMode: ViewMode;
  entryExists: boolean;
  autosaveDirty: boolean;
  dirty: boolean;
  baseChangedExternally: boolean;
}

export const activeTab = (
  tabs: readonly TabSession[],
  activeId: string | null,
): TabSession | null => tabs.find((tab) => tab.id === activeId) ?? null;

export const toTabBarItems = (tabs: readonly TabSession[]): TabBarItem[] =>
  tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    path: tab.payload?.path ?? '',
    dirty: tab.dirty,
  }));

export function buildRestoreEntry(
  state: AppState,
  annotations: readonly ReviewAnnotation[],
): AutosaveEntry | null {
  if (!state.basePath || !state.baseStat) return null;
  return {
    version: 2,
    basePath: state.basePath,
    baseOriginal: state.baseOriginal,
    baseStat: state.baseStat,
    baseRaw: state.baseRaw,
    operations: [],
    redoStack: [],
    globalNote: state.globalNote,
    savedAt: new Date().toISOString(),
    annotations: annotations.slice(),
  };
}

export async function ensureCanAddTab(args: {
  tabs: readonly TabSession[];
  path: string | null;
  bridge: AkapenBridge;
  notifyPremiumRequired(): void;
}): Promise<boolean> {
  const { tabs, path, bridge, notifyPremiumRequired } = args;
  if (path && tabs.some((tab) => tab.payload?.path === path)) return true;
  if (tabs.length >= MAX_TABS) {
    void bridge.showError({
      message: t('tabs.maxReachedTitle'),
      detail: t('tabs.maxReachedDetail'),
    });
    return false;
  }
  if (tabs.length === 0) return true;
  if (!bridge.isPremiumUnlocked) return true;
  try {
    if (await bridge.isPremiumUnlocked()) return true;
  } catch {
    // Treat license check failures as locked; the plan dialog provides the recovery path.
  }
  notifyPremiumRequired();
  return false;
}

export function moveTabInList(
  tabs: TabSession[],
  sourceId: string,
  targetId: string,
): boolean {
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return false;
  const [source] = tabs.splice(sourceIndex, 1);
  tabs.splice(targetIndex, 0, source);
  return true;
}
