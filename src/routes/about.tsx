import { createFileRoute } from '@tanstack/solid-router'
import { renderHtml } from '@tanstack/markdown/html'
import {
  Show,
  Suspense,
  createMemo,
  createResource,
  createSignal,
  onMount,
} from 'solid-js'
import { isServer } from 'solid-js/web'
import type { Setter } from 'solid-js'
import { fastcapHighlighter } from '~/lib/highlighter'
import { getFastCapReadme } from './about.functions'

export const Route = createFileRoute('/about')({
  component: About,
})

const README_URL =
  'https://raw.githubusercontent.com/ani-uni/fastcap/master/README.md'
const CACHE_KEY = 'fastcap-readme-cache'
const CLIENT_TIMEOUT_MS = 5000

function createCachedSignal(
  key: string,
  init: string | undefined,
): [() => string | undefined, Setter<string | undefined>] {
  const [get, set] = createSignal(init)
  return [
    get,
    ((
      value:
        | string
        | undefined
        | ((prev: string | undefined) => string | undefined),
    ) => {
      const next = typeof value === 'function' ? value(get()) : value
      if (!isServer) {
        try {
          if (next !== undefined) localStorage.setItem(key, next)
        } catch {
          // localStorage may be unavailable (private browsing); ignore
        }
      }
      return set(value)
    }) as unknown as Setter<string | undefined>,
  ]
}

function Markdown() {
  const cached = isServer
    ? undefined
    : (localStorage.getItem(CACHE_KEY) ?? undefined)
  const [readme] = createResource<string, string>(
    () => README_URL,
    async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to fetch README: ${res.status}`)
      return await res.text()
    },
    {
      initialValue: cached,
      storage: (init) => createCachedSignal(CACHE_KEY, init),
    },
  )
  const [serverReadme, setServerReadme] = createSignal<string>()
  const [serverLoading, setServerLoading] = createSignal(false)

  onMount(() => {
    if (readme()) return
    const timer = setTimeout(() => {
      if (readme()) return
      setServerLoading(true)
      getFastCapReadme()
        .then(setServerReadme)
        .catch(() => {})
        .finally(() => setServerLoading(false))
    }, CLIENT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  })

  const content = createMemo(() => {
    if (readme.state === 'ready') return readme()
    return serverReadme()
  })
  const html = createMemo(() => {
    const md = content()
    return md
      ? renderHtml(md, {
          highlighter: (code, lang) =>
            fastcapHighlighter.highlightToHtml(code, { lang }),
          codeLineNumbers: true,
        })
      : ''
  })

  return (
    <Suspense fallback={<MarkdownSkeleton />}>
      <Show
        when={serverLoading()}
        fallback={
          <Show
            when={readme.error && !serverReadme()}
            fallback={
              <article
                class="prose prose-slate dark:prose-invert max-w-none"
                innerHTML={html()}
              />
            }
          >
            <p class="text-destructive">
              Failed to load README.{' '}
              <a href={README_URL} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </p>
          </Show>
        }
      >
        <ServerLoadingIndicator />
      </Show>
    </Suspense>
  )
}

function ServerLoadingIndicator() {
  return (
    <div class="flex items-center gap-3 text-sm text-muted-foreground">
      <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>正在从服务器加载文档…</span>
    </div>
  )
}

function MarkdownSkeleton() {
  return (
    <div class="prose prose-slate dark:prose-invert max-w-none animate-pulse">
      <div class="h-8 w-3/4 rounded bg-muted" />
      <div class="mt-4 h-4 w-full rounded bg-muted" />
      <div class="mt-2 h-4 w-5/6 rounded bg-muted" />
      <div class="mt-2 h-4 w-4/6 rounded bg-muted" />
      <div class="mt-8 h-6 w-1/2 rounded bg-muted" />
      <div class="mt-4 h-4 w-full rounded bg-muted" />
      <div class="mt-2 h-4 w-3/4 rounded bg-muted" />
    </div>
  )
}

function About() {
  return (
    <main class="page-wrap px-4 py-12">
      <Markdown />
    </main>
  )
}
