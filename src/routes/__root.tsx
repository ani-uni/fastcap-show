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

export const Route = createRootRouteWithContext()({
  head: () => ({
    links: [{ rel: 'stylesheet', href: styleCss }],
  }),
  shellComponent: RootComponent,
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
