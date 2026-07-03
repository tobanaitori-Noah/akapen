import { en } from './en';
import { ja } from './ja';

export type AkapenLanguage = 'ja' | 'en';
export type TranslationKey = keyof typeof ja;

type TranslationParams = Record<string, string | number>;
type LanguageListener = (language: AkapenLanguage) => void;

const dictionaries = { ja, en } satisfies Record<AkapenLanguage, Record<TranslationKey, string>>;
const listeners = new Set<LanguageListener>();

let currentLanguage: AkapenLanguage = 'ja';

export function normalizeLanguage(value: unknown): AkapenLanguage {
  return value === 'en' ? 'en' : 'ja';
}

export function getLanguage(): AkapenLanguage {
  return currentLanguage;
}

export function setLanguage(language: AkapenLanguage): void {
  if (language === currentLanguage) return;
  currentLanguage = language;
  for (const listener of listeners) listener(currentLanguage);
}

export function onLanguageChange(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function t(key: TranslationKey, params: TranslationParams = {}): string {
  return dictionaries[currentLanguage][key].replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
