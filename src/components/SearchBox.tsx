import { Show, For, createSignal, onCleanup } from 'solid-js'
import {
  searchStore,
  setSearchQuery,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from '~/lib/search-history'

export function SearchBox(props: {
  placeholder?: string
  onSearch: (query: string) => void
}) {
  const [focused, setFocused] = createSignal(false)
  const [localQuery, setLocalQuery] = createSignal(searchStore.state.query)

  const unsub = searchStore.subscribe(() => {
    setLocalQuery(searchStore.state.query)
  })

  onCleanup(() => unsub.unsubscribe())

  const handleInput = (event: InputEvent) => {
    const value = (event.target as HTMLInputElement).value
    setLocalQuery(value)
    setSearchQuery(value)
  }

  const handleSearch = () => {
    const query = localQuery().trim()
    if (!query) return
    addSearchHistory(query)
    props.onSearch(query)
  }

  const handleHistoryClick = (keyword: string) => {
    setLocalQuery(keyword)
    setSearchQuery(keyword)
    props.onSearch(keyword)
  }

  const showDropdown = () => focused() && searchStore.state.history.length > 0

  return (
    <div class="relative flex gap-2">
      <div class="relative min-w-0 flex-1">
        <input
          value={localQuery()}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
          placeholder={props.placeholder ?? '搜索...'}
          class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <Show when={showDropdown()}>
          <div class="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-background shadow-lg">
            <For each={searchStore.state.history}>
              {(item: string) => (
                <div class="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleHistoryClick(item)}
                    class="min-w-0 flex-1 truncate text-left text-sm text-foreground"
                  >
                    {item}
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => removeSearchHistory(item)}
                    class="flex-none text-xs text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
            <div class="border-t border-border px-3 py-2">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={clearSearchHistory}
                class="text-xs text-muted-foreground hover:text-foreground"
              >
                清空历史
              </button>
            </div>
          </div>
        </Show>
      </div>
      <button
        type="button"
        onClick={handleSearch}
        class="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-80"
      >
        搜索
      </button>
    </div>
  )
}
