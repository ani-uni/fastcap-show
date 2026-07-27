import { createServerFn } from '@tanstack/solid-start'

export const getFastCapReadme = createServerFn({ method: 'GET' }).handler(
  async () => {
    const res = await fetch(
      'https://raw.githubusercontent.com/ani-uni/fastcap/master/README.md',
    )
    if (!res.ok) throw new Error(`Failed to fetch README: ${res.status}`)
    return await res.text()
  },
)
