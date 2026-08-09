import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ff-theme'

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function readInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark() ? 'dark' : 'light'
}

// The `data-theme` attribute drives every dark-mode CSS override in index.css. index.html
// has an inline boot script that sets it before first paint (avoids a light-mode flash) —
// this just keeps the store in sync and re-applies it on every toggle/profile sync.
function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

type ThemeState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: readInitialTheme(),
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
}))

applyTheme(useThemeStore.getState().theme)
