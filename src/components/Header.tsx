import { Link } from '@tanstack/solid-router'
import { For } from 'solid-js'

interface InternalLink {
  type: 'internal'
  label: string
  to: string
}

interface ExternalLink {
  type: 'external'
  label: string
  href: string
}

type NavItem = InternalLink | ExternalLink

const navItems: Array<NavItem> = [
  { type: 'internal', label: '主页', to: '/' },
  { type: 'internal', label: '理念/文档', to: '/about' },
  {
    type: 'external',
    label: 'GitHub',
    href: 'https://github.com/ani-uni/fastcap',
  },
]

export default function Header() {
  return (
    <header class="border-b border-border bg-background/80 backdrop-blur-sm">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
        <Link
          to="/"
          class="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span class="h-2.5 w-2.5 rounded-full bg-primary" />
          FastCap Show
        </Link>

        <nav class="ml-auto flex items-center gap-1 text-sm">
          <For each={navItems}>{(item) => <NavLink item={item} />}</For>
        </nav>
      </div>
    </header>
  )
}

function NavLink(props: { item: NavItem }) {
  const { item } = props

  if (item.type === 'internal') {
    return (
      <Link
        to={item.to}
        class="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        activeProps={{
          class: 'rounded-md px-3 py-1.5 bg-accent text-foreground',
          'aria-current': 'page',
        }}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      class="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {item.label}
    </a>
  )
}
