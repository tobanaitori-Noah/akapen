import type { AkapenLanguage } from '../i18n';
import { getLanguage } from '../i18n';

export type ExportHeaderPresetId = 'default' | 'custom';

export interface ExportSettings {
  headerPreset: ExportHeaderPresetId;
  headerCustomText: string;
  fileNamePattern: string;
}

export interface ExportHeaderPreset {
  id: ExportHeaderPresetId;
  text: string;
  textEn: string;
}

export interface ExportFileNamePreset {
  id: string;
  pattern: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  headerPreset: 'default',
  headerCustomText: '',
  fileNamePattern: '{name}.akapen.md',
};

export const EXPORT_HEADER_PRESETS: readonly ExportHeaderPreset[] = [
  { id: 'default', text: '', textEn: '' },
  { id: 'custom', text: '', textEn: '' },
];

export const EXPORT_FILE_NAME_PRESETS: readonly ExportFileNamePreset[] = [
  { id: 'akapen', pattern: '{name}.akapen.md' },
  { id: 'review', pattern: '{name}.review.md' },
  { id: 'reviewed', pattern: '{name}_reviewed.md' },
];

const PRESET_IDS = new Set<ExportHeaderPresetId>(EXPORT_HEADER_PRESETS.map((item) => item.id));
const LEGACY_PRESET_IDS = new Set(['claude', 'gpt']);

const defaultFetch = (): FetchLike => {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is unavailable');
  }
  return fetch.bind(globalThis);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function isValidFileNamePattern(pattern: string): boolean {
  const value = pattern.trim();
  return (
    value.length > 0 &&
    value.length <= 160 &&
    value.includes('{name}') &&
    !/[\\/:\0]/.test(value) &&
    /\.md$/i.test(value)
  );
}

export function normalizeFileNamePattern(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_EXPORT_SETTINGS.fileNamePattern;
  const pattern = value.trim();
  return isValidFileNamePattern(pattern) ? pattern : DEFAULT_EXPORT_SETTINGS.fileNamePattern;
}

export function normalizeExportSettings(value: unknown): ExportSettings {
  if (!isRecord(value)) return { ...DEFAULT_EXPORT_SETTINGS };
  const headerPreset = normalizeExportHeaderPreset(value.headerPreset);
  return {
    headerPreset,
    headerCustomText:
      typeof value.headerCustomText === 'string'
        ? value.headerCustomText.replace(/\r\n?/g, '\n').trim()
        : DEFAULT_EXPORT_SETTINGS.headerCustomText,
    fileNamePattern: normalizeFileNamePattern(value.fileNamePattern),
  };
}

function normalizeExportHeaderPreset(value: unknown): ExportHeaderPresetId {
  if (typeof value !== 'string') return DEFAULT_EXPORT_SETTINGS.headerPreset;
  if (PRESET_IDS.has(value as ExportHeaderPresetId)) return value as ExportHeaderPresetId;
  if (LEGACY_PRESET_IDS.has(value)) return DEFAULT_EXPORT_SETTINGS.headerPreset;
  return DEFAULT_EXPORT_SETTINGS.headerPreset;
}

export function getExportHeaderPresetText(
  presetId: ExportHeaderPresetId,
  language: AkapenLanguage = getLanguage(),
): string {
  const preset = EXPORT_HEADER_PRESETS.find((item) => item.id === presetId);
  if (!preset) return '';
  return language === 'en' ? preset.textEn : preset.text;
}

export function buildExportHeader(
  defaultHeader: string,
  settings: unknown,
  language: AkapenLanguage = getLanguage(),
): string {
  const normalized = normalizeExportSettings(settings);
  if (normalized.headerPreset === 'default') return defaultHeader;
  if (normalized.headerPreset === 'custom') return normalized.headerCustomText || defaultHeader;
  return defaultHeader;
}

export function fileNameStemForPattern(baseFileName: string): string {
  const leaf = baseFileName.split(/[\\/]/).pop() || baseFileName;
  return leaf.replace(/\.md$/i, '');
}

export function applyExportFileNamePattern(
  baseFileName: string,
  settingsOrPattern: ExportSettings | string,
): string {
  const pattern =
    typeof settingsOrPattern === 'string'
      ? normalizeFileNamePattern(settingsOrPattern)
      : normalizeExportSettings(settingsOrPattern).fileNamePattern;
  return pattern.replaceAll('{name}', fileNameStemForPattern(baseFileName));
}

export async function loadExportSettings(
  fetcher: FetchLike = defaultFetch(),
): Promise<ExportSettings> {
  try {
    const res = await fetcher('/api/export-settings');
    if (!res.ok) return { ...DEFAULT_EXPORT_SETTINGS };
    return normalizeExportSettings(await res.json());
  } catch {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
}

export async function saveExportSettings(
  settings: ExportSettings,
  fetcher: FetchLike = defaultFetch(),
): Promise<ExportSettings> {
  const normalized = normalizeExportSettings(settings);
  const res = await fetcher('/api/export-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return normalized;
}

export async function isExportSettingsFeatureUnlocked(): Promise<boolean> {
  const bridge = typeof window !== 'undefined' ? window.akapen : undefined;
  if (bridge?.isPremiumUnlocked) {
    return bridge.isPremiumUnlocked();
  }
  const res = await defaultFetch()('/api/license/status');
  if (!res.ok) return false;
  const data = (await res.json()) as { status?: string; license?: { licensed?: boolean } };
  return data.status === 'ok' && data.license?.licensed === true;
}
