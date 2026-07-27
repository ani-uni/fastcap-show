import { createFileRoute } from '@tanstack/solid-router'
import { renderHtml } from '@tanstack/markdown/html'
import {
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from 'solid-js'
import { isServer } from 'solid-js/web'
import { createServerFn } from '@tanstack/solid-start'
import { staticFunctionMiddleware } from '@tanstack/start-static-server-functions'
import { useQuery } from '@tanstack/solid-query'
import { fastcapHighlighter } from '~/lib/highlighter'

export const Route = createFileRoute('/about')({
  component: About,
})

const README_URL =
  'https://raw.githubusercontent.com/ani-uni/fastcap/master/README.md'
const CACHE_KEY = 'fastcap-readme-cache'
const CLIENT_TIMEOUT_MS = 2000

const getFastCapReadme = createServerFn({ method: 'GET' })
  .middleware([staticFunctionMiddleware])
  .handler(async () => {
    const res = await fetch(README_URL)
    if (!res.ok) throw new Error(`Failed to fetch README: ${res.status}`)
    return await res.text()
  })

async function fetchReadmeClient(): Promise<string> {
  const res = await fetch(README_URL)
  if (!res.ok) throw new Error(`Failed to fetch README: ${res.status}`)
  const text = await res.text()
  if (!isServer) {
    try {
      localStorage.setItem(CACHE_KEY, text)
    } catch {
      // localStorage may be unavailable (private browsing); ignore
    }
  }
  return text
}

function Markdown() {
  const cached = isServer
    ? undefined
    : (localStorage.getItem(CACHE_KEY) ?? undefined)

  const query = useQuery(() => ({
    queryKey: ['fastcap-readme'],
    queryFn: fetchReadmeClient,
    initialData: cached,
    staleTime: 5 * 60 * 1000,
    retry: false,
    networkMode: 'offlineFirst',
  }))

  const [serverReadme, setServerReadme] = createSignal<string>()
  const [serverLoading, setServerLoading] = createSignal(false)
  const [useServerFallback, setUseServerFallback] = createSignal(false)

  // 客户端超时兜底
  onMount(() => {
    if (query.data) return
    const timer = setTimeout(() => {
      if (query.data || useServerFallback()) return
      setUseServerFallback(true)
      setServerLoading(true)
      getFastCapReadme()
        .then(setServerReadme)
        .catch(() => {})
        .finally(() => setServerLoading(false))
    }, CLIENT_TIMEOUT_MS)
    return () => clearTimeout(timer)
  })

  // 客户端失败兜底
  createEffect(() => {
    if (query.error && !useServerFallback() && !serverReadme()) {
      setUseServerFallback(true)
      setServerLoading(true)
      getFastCapReadme()
        .then(setServerReadme)
        .catch(() => {})
        .finally(() => setServerLoading(false))
    }
  })

  const content = createMemo(() => {
    if (query.data) return query.data
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
            when={query.error && !serverReadme()}
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
      <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border border-current border-t-transparent" />
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
