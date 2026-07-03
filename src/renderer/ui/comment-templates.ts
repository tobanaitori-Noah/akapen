import type { AkapenLanguage } from '../i18n';
import { getLanguage } from '../i18n';

export interface CommentTemplate {
  id: string;
  text: string;
  textEn?: string;
  isPreset: boolean;
  usageCount?: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const COMMENT_TEMPLATE_PRESETS: readonly CommentTemplate[] = [
  {
    id: 'preset-concrete-example',
    text: '具体例を追加して補強',
    textEn: 'Add a concrete example to strengthen this',
    isPreset: true,
  },
  {
    id: 'preset-reader-perspective',
    text: '読者目線で書き直し',
    textEn: "Rewrite from the reader's perspective",
    isPreset: true,
  },
  {
    id: 'preset-trim-verbose',
    text: '冗長なので削って短く',
    textEn: 'Too verbose -- trim and shorten',
    isPreset: true,
  },
  {
    id: 'preset-evidence',
    text: '根拠が弱い。データか出典を追加',
    textEn: 'Weak evidence -- add data or citation',
    isPreset: true,
  },
  {
    id: 'preset-lead-conclusion',
    text: '結論を先に持ってきて',
    textEn: 'Lead with the conclusion',
    isPreset: true,
  },
  {
    id: 'preset-necessary-paragraph',
    text: 'この段落は本当に必要？',
    textEn: 'Is this paragraph really needed?',
    isPreset: true,
  },
  {
    id: 'preset-make-concrete',
    text: '抽象的すぎる。具体的に',
    textEn: 'Too abstract -- make it concrete',
    isPreset: true,
  },
  {
    id: 'preset-logical-gap',
    text: '論理の飛躍がある。間を埋めて',
    textEn: 'Logical gap -- fill in the missing step',
    isPreset: true,
  },
  {
    id: 'preset-conversational',
    text: '口語寄りのトーンに',
    textEn: 'Shift to a more conversational tone',
    isPreset: true,
  },
  {
    id: 'preset-heading-mismatch',
    text: '見出しと内容がズレている',
    textEn: "Heading doesn't match the content",
    isPreset: true,
  },
];

const defaultFetch = (): FetchLike => {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is unavailable');
  }
  return fetch.bind(globalThis);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeUsageCount = (value: unknown): number => {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
};

export function normalizeCommentTemplates(value: unknown): CommentTemplate[] {
  const input = Array.isArray(value) ? value : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of input) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    byId.set(item.id, item);
  }

  const result: CommentTemplate[] = COMMENT_TEMPLATE_PRESETS.map((preset) => {
    const stored = byId.get(preset.id);
    if (!stored) return { ...preset, usageCount: 0 };
    const text = normalizeText(stored.text) || preset.text;
    const textEn = normalizeText(stored.textEn) || preset.textEn;
    return {
      id: preset.id,
      text,
      textEn,
      isPreset: true,
      usageCount: normalizeUsageCount(stored.usageCount),
    };
  });
  result.sort(
    (a, b) =>
      (b.usageCount ?? 0) - (a.usageCount ?? 0) ||
      COMMENT_TEMPLATE_PRESETS.findIndex((preset) => preset.id === a.id) -
        COMMENT_TEMPLATE_PRESETS.findIndex((preset) => preset.id === b.id),
  );

  const used = new Set(result.map((item) => item.id));
  for (const item of input) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    if (used.has(item.id) || item.isPreset === true) continue;
    const text = normalizeText(item.text);
    if (!text) continue;
    result.push({
      id: item.id,
      text,
      textEn: normalizeText(item.textEn) || undefined,
      isPreset: false,
      usageCount: normalizeUsageCount(item.usageCount),
    });
    used.add(item.id);
  }

  return result;
}

export function createCustomTemplate(text = '', textEn = ''): CommentTemplate {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `custom-${random}`,
    text,
    textEn: textEn || undefined,
    isPreset: false,
    usageCount: 0,
  };
}

export function getCommentTemplateText(
  template: CommentTemplate,
  language: AkapenLanguage = getLanguage(),
): string {
  if (language === 'en') return template.textEn?.trim() || template.text;
  return template.text;
}

const TEMPLATE_PLACEHOLDER_LABELS = new Set(['新しいテンプレート', 'New template']);

export function isCommentTemplateSelectable(template: CommentTemplate): boolean {
  const labels = [template.text.trim(), template.textEn?.trim() ?? ''].filter(
    (label) => label.length > 0,
  );
  if (labels.length === 0) return false;
  return !labels.every((label) => TEMPLATE_PLACEHOLDER_LABELS.has(label));
}

export function selectableCommentTemplates(
  templates: readonly CommentTemplate[],
): CommentTemplate[] {
  return templates.filter(isCommentTemplateSelectable);
}

export function appendTemplateText(currentValue: string, templateText: string): string {
  const addition = templateText.trim();
  if (!addition) return currentValue;
  if (currentValue.length === 0) return addition;
  return /\s$/.test(currentValue) ? `${currentValue}${addition}` : `${currentValue}\n${addition}`;
}

export async function loadCommentTemplates(
  fetcher: FetchLike = defaultFetch(),
): Promise<CommentTemplate[]> {
  try {
    const res = await fetcher('/api/templates');
    if (!res.ok) return normalizeCommentTemplates([]);
    return normalizeCommentTemplates(await res.json());
  } catch {
    return normalizeCommentTemplates([]);
  }
}

export async function saveCommentTemplates(
  templates: readonly CommentTemplate[],
  fetcher: FetchLike = defaultFetch(),
): Promise<void> {
  const res = await fetcher('/api/templates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalizeCommentTemplates(templates)),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
}

export async function recordCommentTemplateUsage(
  templateId: string,
  fetcher: FetchLike = defaultFetch(),
): Promise<CommentTemplate[]> {
  const templates = await loadCommentTemplates(fetcher);
  const updated = templates.map((template) =>
    template.id === templateId
      ? { ...template, usageCount: normalizeUsageCount(template.usageCount) + 1 }
      : template,
  );
  await saveCommentTemplates(updated, fetcher);
  return normalizeCommentTemplates(updated);
}

export async function isCommentTemplateFeatureUnlocked(): Promise<boolean> {
  const bridge = typeof window !== 'undefined' ? window.akapen : undefined;
  if (bridge?.isPremiumUnlocked) {
    return bridge.isPremiumUnlocked();
  }
  const res = await defaultFetch()('/api/license/status');
  if (!res.ok) return false;
  const data = (await res.json()) as { status?: string; license?: { licensed?: boolean } };
  return data.status === 'ok' && data.license?.licensed === true;
}
