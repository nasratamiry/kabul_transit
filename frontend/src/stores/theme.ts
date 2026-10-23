import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const KEY = 'kc.theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* fall through */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface ThemeState {
  theme: Theme;
  toggle(): void;
}

export const useTheme = create<ThemeState>()((set, get) => {
  const theme = initialTheme();
  apply(theme);
  return {
    theme,
    toggle() {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* not persisted */
      }
      set({ theme: next });
    },
  };
});
