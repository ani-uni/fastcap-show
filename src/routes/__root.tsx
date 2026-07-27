import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/solid-router'
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'

import '@fontsource/inter/400.css'

import { HydrationScript } from 'solid-js/web'
import { Suspense } from 'solid-js'
import { QueryClientProvider } from '@tanstack/solid-query'

import Header from '../components/Header'

import styleCss from '../styles.css?url'
import { getContext } from '../integrations/tanstack-query/provider'

function DefaultErrorComponent(props: { error: Error; reset: () => void }) {
  return (
    <div class="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p class="text-2xl font-semibold text-foreground">出错了</p>
      <p class="max-w-md text-sm text-muted-foreground">
        {props.error.message}
      </p>
      <button
        type="button"
        onClick={props.reset}
        class="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
      >
        重试
      </button>
    </div>
  )
}

export const Route = createRootRouteWithContext()({
  head: () => ({
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'stylesheet', href: styleCss },
    ],
  }),
  shellComponent: RootComponent,
  errorComponent: DefaultErrorComponent,
})

function RootComponent() {
  const { queryClient } = getContext()
  return (
    <QueryClientProvider client={queryClient}>
      <html>
        <head>
          <HydrationScript />
          <HeadContent />
        </head>
        <body>
          <Suspense>
            <Header />
            <Outlet />
            <TanStackRouterDevtools />
          </Suspense>
          <Scripts />
        </body>
      </html>
    </QueryClientProvider>
  )
}
