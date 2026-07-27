import { createEffect, createSignal } from 'solid-js'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'fastcap-show:theme'

function getStoredTheme(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return null
}

function applyTheme(mode: ThemeMode | null) {
  const root = document.documentElement
  const isDark =
    mode === 'dark' ||
    (mode === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', isDark)
}

const [mode, setMode] = createSignal<ThemeMode | null>(getStoredTheme())

let initialized = false

createEffect(() => {
  const current = mode()
  applyTheme(current)
  if (!initialized) {
    initialized = true
    const stored = getStoredTheme()
    if (stored !== current) {
      setMode(stored)
      return
    }
  }
  try {
    if (current === null) return
    localStorage.setItem(STORAGE_KEY, current)
  } catch {
    // localStorage unavailable
  }
})

export function useTheme() {
  return {
    mode,
    setMode,
  }
}

if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => {
      if (mode() === 'system') {
        applyTheme(e.matches ? 'dark' : 'light')
      }
    })
}
