import type { ShortcutSettings } from './bridge';
import { t, type TranslationKey } from './i18n';

export type ShortcutCommandId =
  | 'delete-mark'
  | 'comment'
  | 'remove-marks'
  | 'remove-deletion'
  | 'remove-comment'
  | 'format-heading-1'
  | 'format-heading-2'
  | 'format-heading-3'
  | 'format-bold'
  | 'format-bullet-list'
  | 'save'
  | 'toggle-view'
  | 'undo'
  | 'redo';

export interface ShortcutCommandDefinition {
  id: ShortcutCommandId;
  labelKey: TranslationKey;
  defaultBinding: string;
}

export type ShortcutBindings = Record<ShortcutCommandId, string>;

export const SHORTCUT_COMMANDS: readonly ShortcutCommandDefinition[] = [
  { id: 'delete-mark', labelKey: 'shortcut.deleteMark', defaultBinding: 'Mod-Shift-D' },
  { id: 'comment', labelKey: 'shortcut.comment', defaultBinding: 'Mod-Shift-C' },
  /**
   * plan15 M1 修正: remove-marks は後方互換シムとして残すが defaultBinding を ''（未割り当て）に変更。
   * Mod-Shift-X は remove-deletion と remove-comment が担う（下記）。
   * app.ts の 'remove-marks' case は commandIdForBinding が remove-deletion/remove-comment を
   * 返す前の fallback として残す。
   * @deprecated plan16 で remove-deletion / remove-comment に完全移行後に削除予定。
   */
  { id: 'remove-marks', labelKey: 'shortcut.removeMarksCompat', defaultBinding: '' },
  /** plan15 C-2: 削除マーク解除専用（Mod-Shift-X） */
  { id: 'remove-deletion', labelKey: 'shortcut.removeDeletion', defaultBinding: 'Mod-Shift-X' },
  /** plan15 C-2: コメント削除専用（Mod-Shift-X） */
  { id: 'remove-comment', labelKey: 'shortcut.removeComment', defaultBinding: 'Mod-Shift-X' },
  { id: 'format-heading-1', labelKey: 'shortcut.heading1', defaultBinding: 'Mod-Alt-1' },
  { id: 'format-heading-2', labelKey: 'shortcut.heading2', defaultBinding: 'Mod-Alt-2' },
  { id: 'format-heading-3', labelKey: 'shortcut.heading3', defaultBinding: 'Mod-Alt-3' },
  { id: 'format-bold', labelKey: 'shortcut.bold', defaultBinding: 'Mod-B' },
  { id: 'format-bullet-list', labelKey: 'shortcut.bulletList', defaultBinding: 'Mod-Shift-8' },
  { id: 'save', labelKey: 'shortcut.save', defaultBinding: 'Mod-S' },
  { id: 'toggle-view', labelKey: 'shortcut.toggleView', defaultBinding: 'Mod-E' },
  { id: 'undo', labelKey: 'shortcut.undo', defaultBinding: 'Mod-Z' },
  { id: 'redo', labelKey: 'shortcut.redo', defaultBinding: 'Mod-Shift-Z' },
] as const;

export function shortcutCommandLabel(id: ShortcutCommandId): string {
  const command = SHORTCUT_COMMANDS.find((item) => item.id === id);
  return command ? t(command.labelKey) : id;
}

export const DEFAULT_SHORTCUT_BINDINGS = Object.fromEntries(
  SHORTCUT_COMMANDS.map((command) => [command.id, command.defaultBinding]),
) as ShortcutBindings;

const COMMAND_IDS = new Set<ShortcutCommandId>(
  SHORTCUT_COMMANDS.map((command) => command.id),
);

const DEFAULT_BINDING_SET = new Set(Object.values(DEFAULT_SHORTCUT_BINDINGS));
const RESERVED_BINDINGS = new Set(['Mod-Q', 'Mod-W', 'Mod-H', 'Mod-M']);

const KEY_BY_CODE: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
};

function keyNameFromEvent(event: KeyboardEvent): string | null {
  if (event.key === 'Meta' || event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt') {
    return null;
  }
  if (event.isComposing || event.key === 'Process' || event.key === 'Dead') return null;
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  if (KEY_BY_CODE[event.code]) return KEY_BY_CODE[event.code];
  if (/^F\d{1,2}$/.test(event.key)) return event.key;
  if (event.key.startsWith('Arrow')) return event.key;
  if (event.key === 'Escape' || event.key === 'Enter' || event.key === 'Tab') return event.key;
  if (event.key === ' ') return 'Space';
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key.length > 0 ? event.key : null;
}

export function normalizeShortcutEvent(event: KeyboardEvent): string | null {
  const key = keyNameFromEvent(event);
  if (!key) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push('Mod');
  if (event.ctrlKey && !event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('-');
}

function hasModifier(binding: string): boolean {
  return /^(?:Mod|Ctrl|Alt|Shift)-/.test(binding);
}

function isUnmodifiedPrintable(binding: string): boolean {
  if (hasModifier(binding)) return false;
  return binding.length === 1 || binding === 'Space';
}

export function validateShortcutCandidate(
  binding: string | null,
  bindings: ShortcutBindings,
  commandId: ShortcutCommandId,
): { ok: true } | { ok: false; message: string } {
  if (!binding) return { ok: false, message: t('shortcut.invalidKey') };
  if (RESERVED_BINDINGS.has(binding)) {
    return { ok: false, message: t('shortcut.reservedMac') };
  }
  if ((binding.includes('Mod') || binding.includes('Ctrl')) && binding.endsWith('-Space')) {
    return { ok: false, message: t('shortcut.osInputSwitch') };
  }
  if (isUnmodifiedPrintable(binding)) {
    return { ok: false, message: t('shortcut.printableOnly') };
  }
  const duplicate = commandIdForBinding(bindings, binding);
  if (duplicate && duplicate !== commandId) {
    return { ok: false, message: t('shortcut.duplicate', { label: shortcutCommandLabel(duplicate) }) };
  }
  return { ok: true };
}

export function createShortcutBindings(settings?: ShortcutSettings | null): ShortcutBindings {
  const bindings: ShortcutBindings = { ...DEFAULT_SHORTCUT_BINDINGS };
  if (!settings || settings.version !== 1 || typeof settings.bindings !== 'object') {
    return bindings;
  }
  for (const [id, binding] of Object.entries(settings.bindings)) {
    if (COMMAND_IDS.has(id as ShortcutCommandId) && typeof binding === 'string') {
      bindings[id as ShortcutCommandId] = binding;
    }
  }
  return bindings;
}

export function shortcutSettingsFromBindings(bindings: ShortcutBindings): ShortcutSettings {
  return { version: 1, bindings: { ...bindings } };
}

export function commandIdForBinding(
  bindings: ShortcutBindings,
  binding: string,
): ShortcutCommandId | null {
  for (const command of SHORTCUT_COMMANDS) {
    if (bindings[command.id] === binding) return command.id;
  }
  return null;
}

export function isKnownDefaultBinding(binding: string): boolean {
  return DEFAULT_BINDING_SET.has(binding);
}

export function bindingToDisplay(binding: string): string {
  const symbols: Record<string, string> = {
    Mod: '⌘',
    Ctrl: '⌃',
    Alt: '⌥',
    Shift: '⇧',
    Space: 'Space',
  };
  return binding
    .split('-')
    .map((part) => symbols[part] ?? part)
    .join('');
}

export function bindingToCodeMirrorKey(binding: string): string {
  const parts = binding.split('-');
  const key = parts[parts.length - 1];
  const normalizedKey = /^[A-Z]$/.test(key) ? key.toLowerCase() : key;
  return [...parts.slice(0, -1), normalizedKey].join('-');
}
