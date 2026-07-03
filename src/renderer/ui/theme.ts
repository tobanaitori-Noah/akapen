import type { AkapenTheme } from '../bridge';

export type ResolvedAkapenTheme = 'light' | 'dark';

export interface ThemeControllerOptions {
  initialTheme?: AkapenTheme;
  root?: Pick<HTMLElement, 'dataset' | 'style'>;
  matchMedia?: (query: string) => MediaQueryList;
}

export interface ThemeController {
  getTheme(): AkapenTheme;
  getResolvedTheme(): ResolvedAkapenTheme;
  setTheme(theme: AkapenTheme | undefined): AkapenTheme;
  destroy(): void;
}

const THEME_VALUES = new Set<AkapenTheme>(['light', 'dark', 'auto']);
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isAkapenTheme(value: unknown): value is AkapenTheme {
  return typeof value === 'string' && THEME_VALUES.has(value as AkapenTheme);
}

export function normalizeThemePreference(value: unknown): AkapenTheme {
  return isAkapenTheme(value) ? value : 'light';
}

export function resolveThemePreference(
  theme: AkapenTheme,
  prefersDark: boolean,
): ResolvedAkapenTheme {
  if (theme === 'auto') return prefersDark ? 'dark' : 'light';
  return theme;
}

export function createThemeController(
  options: ThemeControllerOptions = {},
): ThemeController {
  const root = options.root ?? document.documentElement;
  const matchMediaFn = options.matchMedia ?? window.matchMedia.bind(window);
  const media = matchMediaFn(DARK_QUERY);
  let theme = normalizeThemePreference(options.initialTheme);
  let resolvedTheme: ResolvedAkapenTheme = 'light';

  const apply = (): void => {
    resolvedTheme = resolveThemePreference(theme, media.matches);
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  };

  const onSystemThemeChange = (): void => {
    if (theme === 'auto') apply();
  };

  apply();
  if (media.addEventListener) {
    media.addEventListener('change', onSystemThemeChange);
  } else {
    media.addListener?.(onSystemThemeChange);
  }

  return {
    getTheme: () => theme,
    getResolvedTheme: () => resolvedTheme,
    setTheme(next) {
      theme = normalizeThemePreference(next);
      apply();
      return theme;
    },
    destroy() {
      if (media.removeEventListener) {
        media.removeEventListener('change', onSystemThemeChange);
      } else {
        media.removeListener?.(onSystemThemeChange);
      }
    },
  };
}
