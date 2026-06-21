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
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-zinc-400">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-400"
          aria-hidden
        />
        <span className="text-sm">{t(lang, 'loading')}</span>
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-4 text-zinc-300">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
          <span className="text-3xl" aria-hidden>
            ⚠️
          </span>
          <p className="text-sm font-semibold text-zinc-200">{t(lang, 'loadFailed')}</p>
          <p className="break-all text-xs text-red-400">{load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: 'loading' })
              setReloadKey((k) => k + 1)
            }}
            className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm transition-colors hover:border-zinc-400 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
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
      <header className="border-b border-zinc-800 bg-zinc-950/60 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-xl font-bold text-transparent">
            {t(lang, 'title')}
          </h1>
          <span className="text-sm text-zinc-400">
            Set {stats.setNumber} ・ TFT {stats.tftPatch ?? stats.patch}
          </span>
          <span className="text-sm text-zinc-400">
            {t(lang, 'matchesCount', { n: stats.totals.matches.toLocaleString() })}
          </span>
          <span className="text-xs text-zinc-500">{t(lang, 'generated', { time: generatedAt })}</span>
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'ja' ? 'en' : 'ja'))}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-zinc-600 bg-zinc-800/60 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-400 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            title={t(lang, 'langSwitchTitle')}
          >
            <span aria-hidden>🌐</span>
            {lang === 'ja' ? 'EN' : 'JP'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="shrink-0">{t(lang, 'level')}</span>
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

          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="shrink-0">{t(lang, 'sort')}</span>
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

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="shrink-0">{t(lang, 'adoptionRate')}</span>
            <input
              type="range"
              min={0}
              max={50}
              value={minAdopt}
              onChange={(e) => setMinAdopt(Number(e.target.value))}
              className="w-32 accent-amber-400"
            />
            <span className="w-8 text-right tabular-nums text-zinc-100">{minAdopt}</span>
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[400px] shrink-0 overflow-y-auto border-r border-zinc-800 p-3">
          <h2 className="mb-2 text-sm font-semibold text-zinc-400">{t(lang, 'emblems')}</h2>
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
