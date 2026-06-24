import { useEffect, useState } from 'react'
import type { StatsFile } from '../shared/types'
import { t, type Lang } from './lib/i18n'
import { loadStats } from './lib/data'
import { EmblemGrid } from './components/EmblemGrid'
import { SelectionBar } from './components/SelectionBar'
import { CompList } from './components/CompList'
import { SegmentedControl } from './components/SegmentedControl'
import type { SortKey } from './components/CompCard'

type LevelKey = 'all' | '7' | '8' | '9' | '10'
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stats: StatsFile }

function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  const [selection, setSelection] = useState<number[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('top4')
  const [minAdopt, setMinAdopt] = useState(5)
  const [lang, setLang] = useState<Lang>('ja')
  const [level, setLevel] = useState<LevelKey>('all')

  useEffect(() => {
    let cancelled = false
    loadStats()
      .then((stats) => {
        if (cancelled) return
        setLoad({ status: 'ready', stats })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setLoad({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  if (load.status === 'loading') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-slate-400">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-amber-400"
          aria-hidden
        />
        <span className="text-sm">{t(lang, 'loading')}</span>
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-4 text-slate-300">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center shadow-xl">
          <svg
            className="h-9 w-9 text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <p className="text-sm font-semibold text-slate-200">{t(lang, 'loadFailed')}</p>
          <p className="break-all text-xs text-red-400/80">{load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: 'loading' })
              setReloadKey((k) => k + 1)
            }}
            className="mt-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-1.5 text-sm font-medium transition-colors hover:border-slate-400 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            {t(lang, 'retry')}
          </button>
        </div>
      </div>
    )
  }

  const stats = load.stats

  // レベル = 盤面ユニット数でフィルタ。
  const selectedComps =
    level === 'all' ? stats.comps : stats.comps.filter((c) => c.units.length === Number(level))

  // selection は emblems 配列インデックスのマルチセット。counts[index] = 個数。
  const counts = stats.emblems.map(() => 0)
  for (const idx of selection) counts[idx] = (counts[idx] ?? 0) + 1

  const addEmblem = (index: number) => setSelection((s) => [...s, index])
  const removeEmblem = (index: number) =>
    setSelection((s) => {
      const at = s.indexOf(index)
      if (at === -1) return s
      const next = s.slice()
      next.splice(at, 1)
      return next
    })
  const clear = () => setSelection([])

  const generatedAt = new Date(stats.generatedAt).toLocaleString()

  return (
    <div className="mx-auto flex h-screen w-full max-w-[1440px] flex-col">
      {/* Title & Info Header */}
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-slate-800/50 bg-[#27282b] px-5 py-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-100">
          {t(lang, 'title')}
        </h1>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-slate-800/80 px-2 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-700">
            Set {stats.setNumber}
          </span>
          <span className="rounded-md bg-slate-800/80 px-2 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-700">
            Patch {stats.tftPatch ?? stats.patch}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <div className="flex flex-col items-end">
            <span className="font-semibold text-slate-300">
              {t(lang, 'matchesCount', { n: stats.totals.matches.toLocaleString() })}
            </span>
            <span className="text-[10px] text-slate-500">{t(lang, 'generated', { time: generatedAt })}</span>
          </div>
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'ja' ? 'en' : 'ja'))}
            className="flex h-8 items-center justify-center rounded-lg border border-slate-700 bg-[#36383e] px-3 font-semibold text-slate-200 shadow-sm transition-all hover:bg-[#46484e] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60"
            title={t(lang, 'langSwitchTitle')}
          >
            {lang === 'ja' ? 'EN' : 'JP'}
          </button>
        </div>
      </header>

      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 px-5 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-slate-400">{t(lang, 'level')}</span>
            <SegmentedControl<LevelKey>
              ariaLabel={t(lang, 'level')}
              value={level}
              onChange={setLevel}
              options={[
                { key: 'all', label: t(lang, 'all') },
                { key: '7', label: 'Lv7' },
                { key: '8', label: 'Lv8' },
                { key: '9', label: 'Lv9' },
                { key: '10', label: 'Lv10' },
              ]}
            />
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-slate-400">{t(lang, 'sort')}</span>
            <SegmentedControl<SortKey>
              ariaLabel={t(lang, 'sort')}
              value={sortKey}
              onChange={setSortKey}
              options={[
                { key: 'place', label: t(lang, 'sortPlace') },
                { key: 'top4', label: t(lang, 'sortTop4') },
                { key: 'win', label: t(lang, 'sortWin') },
                { key: 'adopt', label: t(lang, 'sortAdopt') },
              ]}
            />
          </div>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="font-medium text-slate-400">{t(lang, 'adoptionRate')}</span>
            <input
              type="number"
              min={0}
              value={minAdopt}
              onChange={(e) => setMinAdopt(Math.max(0, Number(e.target.value)))}
              className="w-20 rounded border border-slate-700 bg-[#27282b] px-2 py-1.5 text-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60"
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900/20 p-4">
          <h2 className="mb-3 text-sm font-bold tracking-wide text-slate-400">{t(lang, 'emblems')}</h2>
          <EmblemGrid
            emblems={stats.emblems}
            counts={counts}
            lang={lang}
            onAdd={addEmblem}
            onRemove={removeEmblem}
            baseItemIcons={stats.baseItemIcons}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <SelectionBar
            emblems={stats.emblems}
            counts={counts}
            lang={lang}
            onClear={clear}
            onRemove={removeEmblem}
          />
          <CompList
            stats={stats}
            comps={selectedComps}
            sel={selection}
            sortKey={sortKey}
            minAdopt={minAdopt}
            lang={lang}
          />
        </main>
      </div>
    </div>
  )
}

export default App
