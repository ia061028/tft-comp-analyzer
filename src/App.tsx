import { useEffect, useState } from 'react'
import type { StatsFile } from '../shared/types'
import { t, type Lang } from './lib/i18n'
import { loadStats } from './lib/data'
import { EmblemGrid } from './components/EmblemGrid'
import { SelectionBar } from './components/SelectionBar'
import { CompList } from './components/CompList'

type SortKey = 'rate' | 'place' | 'top4' | 'win'
type LevelKey = 'all' | '7' | '8' | '9' | '10'
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stats: StatsFile }

function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  const [selection, setSelection] = useState<number[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('place')
  const [minSample, setMinSample] = useState<number | null>(null)
  const [lang, setLang] = useState<Lang>('ja')
  const [level, setLevel] = useState<LevelKey>('all')

  useEffect(() => {
    let cancelled = false
    loadStats()
      .then((stats) => {
        if (cancelled) return
        setLoad({ status: 'ready', stats })
        setMinSample((cur) => (cur === null ? 5 : cur)) // 採用率(%)の初期値
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
      <div className="flex h-screen items-center justify-center text-zinc-400">
        {t(lang, 'loading')}
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-zinc-300">
        <p className="text-sm font-semibold text-zinc-200">{t(lang, 'loadFailed')}</p>
        <p className="text-xs text-red-400">{load.message}</p>
        <button
          type="button"
          onClick={() => {
            setLoad({ status: 'loading' })
            setReloadKey((k) => k + 1)
          }}
          className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          {t(lang, 'retry')}
        </button>
      </div>
    )
  }

  const stats = load.stats
  // 紋章フィルタ時の絞り込みは「採用率(%)」=その構成内で紋章を装備したゲームの割合。
  // スライダーはその閾値。0〜30%（それ以上は実データ上ほぼ該当しない）。
  const rateMin = 0
  const rateMax = 30
  const ratePct = Math.min(Math.max(minSample ?? 5, rateMin), rateMax)

  // 表示する構成: 全体 or レベル別（古い stats.json に compsByLevel が無い場合は空配列）。
  const selectedComps =
    level === 'all' ? stats.comps : (stats.compsByLevel?.[level] ?? [])

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
    <div className="mx-auto flex h-screen w-full max-w-[1280px] flex-col">
      <header className="border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-100">{t(lang, 'title')}</h1>
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
            className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800/60 px-2.5 py-1 text-xs font-semibold text-zinc-200 hover:border-zinc-400 hover:bg-zinc-800"
            title={t(lang, 'langSwitchTitle')}
          >
            <span aria-hidden>🌐</span>
            {lang === 'ja' ? 'EN' : 'JP'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="shrink-0">{t(lang, 'level')}</span>
            <div className="inline-flex overflow-hidden rounded border border-zinc-700">
              {(
                [
                  ['all', t(lang, 'all')],
                  ['7', 'Lv7'],
                  ['8', 'Lv8'],
                  ['9', 'Lv9'],
                  ['10', 'Lv10'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLevel(key)}
                  className={`px-3 py-1 text-sm ${
                    level === key
                      ? 'bg-amber-400 font-semibold text-zinc-950'
                      : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="shrink-0">{t(lang, 'sort')}</span>
            <div className="inline-flex overflow-hidden rounded border border-zinc-700">
              {(
                [
                  ['place', t(lang, 'sortPlace')],
                  ['top4', t(lang, 'sortTop4')],
                  ['win', t(lang, 'sortWin')],
                  ['rate', t(lang, 'sortRate')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={`px-3 py-1 text-sm ${
                    sortKey === key
                      ? 'bg-amber-400 font-semibold text-zinc-950'
                      : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="shrink-0">{t(lang, 'adoptionRate')}</span>
            <input
              type="range"
              min={rateMin}
              max={rateMax}
              value={ratePct}
              onChange={(e) => setMinSample(Number(e.target.value))}
              className="w-32 accent-amber-400"
            />
            <span className="w-10 text-right tabular-nums text-zinc-100">{ratePct}%</span>
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
          <SelectionBar emblems={stats.emblems} counts={counts} lang={lang} onClear={clear} />
          <CompList
            stats={stats}
            comps={selectedComps}
            sel={selection}
            sortKey={sortKey}
            ratePct={ratePct}
            lang={lang}
          />
        </main>
      </div>
    </div>
  )
}

export default App
