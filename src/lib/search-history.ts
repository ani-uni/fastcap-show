import { Store } from '@tanstack/store'

const STORAGE_KEY = 'fastcap-show:search-history'
const MAX_HISTORY = 10

function loadHistory(): Array<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore
  }
  return []
}

function saveHistory(history: Array<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // ignore
  }
}

function getSearchEpParam(): string {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('search_ep') ?? ''
}

export const searchStore = new Store<{
  query: string
  history: Array<string>
}>({
  query: getSearchEpParam(),
  history: loadHistory(),
})

export function setSearchQuery(query: string) {
  searchStore.setState((state) => ({ ...state, query }))
}

export function addSearchHistory(keyword: string) {
  if (!keyword.trim()) return
  searchStore.setState((state) => {
    const filtered = state.history.filter((item) => item !== keyword)
    const next = [keyword, ...filtered].slice(0, MAX_HISTORY)
    saveHistory(next)
    return { ...state, history: next }
  })
}

export function removeSearchHistory(keyword: string) {
  searchStore.setState((state) => {
    const next = state.history.filter((item) => item !== keyword)
    saveHistory(next)
    return { ...state, history: next }
  })
}

export function clearSearchHistory() {
  searchStore.setState((state) => ({ ...state, history: [] }))
  saveHistory([])
}
