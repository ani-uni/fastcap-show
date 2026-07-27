import { createRouter as createTanStackRouter } from '@tanstack/solid-router'
import { routeTree } from './routeTree.gen'

import { getContext } from './integrations/tanstack-query/provider'

function DefaultNotFoundComponent() {
  return (
    <div class="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p class="text-2xl font-semibold text-foreground">404</p>
      <p class="text-sm text-muted-foreground">页面不存在</p>
    </div>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,

    context: getContext(),

    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: DefaultNotFoundComponent,
  })

  return router
}

declare module '@tanstack/solid-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
