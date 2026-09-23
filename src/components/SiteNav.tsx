import { t, type Lang } from '../lib/i18n'

/** 構成一覧（/）と統計（/stats.html）の行き来。見た目は SegmentedControl に揃える。 */
export function SiteNav({ current, lang }: { current: 'comps' | 'stats'; lang: Lang }) {
  const links = [
    { key: 'comps', href: '/', label: t(lang, 'navComps') },
    { key: 'stats', href: '/stats.html', label: t(lang, 'navStats') },
  ] as const
  return (
    <nav className="inline-flex overflow-hidden rounded-md border border-line bg-surface-2 p-0.5">
      {links.map(({ key, href, label }) => {
        const active = key === current
        return (
          <a
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`rounded px-3 py-1 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
              active ? 'bg-gold text-base shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {label}
          </a>
        )
      })}
    </nav>
  )
}
