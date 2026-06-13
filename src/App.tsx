import { useEffect, useState } from 'react'
import type { StatsFile } from '../shared/types'
import type { Lang } from './lib/i18n'
import { loadStats } from './lib/data'
import { EmblemGrid } from './components/EmblemGrid'
import { SelectionBar } from './components/SelectionBar'
import { CompList } from './components/CompList'

type SortKey = 'place' | 'top4' | 'win' | 'pick'
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
        setMinSample((cur) => (cur === null ? stats.config.minSampleDefault : cur))
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
        読み込み中…
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-zinc-300">
        <p className="text-sm text-red-400">{load.message}</p>
        <button
          type="button"
          onClick={() => {
            setLoad({ status: 'loading' })
            setReloadKey((k) => k + 1)
          }}
          className="rounded border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          再試行
        </button>
      </div>
    )
  }

  const stats = load.stats
  // スライダー基準値。紋章選択中は対象サンプルが小さくなるため実効閾値を緩和する。
  // emblemMinSample は古い stats.json には無い場合があるためフォールバックを置く。
  const baseMinSample = minSample ?? stats.config.minSampleDefault
  const emblemMinSample = stats.config.emblemMinSample ?? 5
  const appliedMinSample =
    selection.length > 0 ? Math.min(baseMinSample, emblemMinSample) : baseMinSample

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
    <div className="flex h-screen flex-col">
      <header className="border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-100">TFT 紋章構成アナライザー</h1>
          <span className="text-sm text-zinc-400">
            Set {stats.setNumber} ・ TFT {stats.tftPatch ?? stats.patch}
          </span>
          <span className="text-sm text-zinc-400">
            {stats.totals.matches.toLocaleString()} マッチ
          </span>
          <span className="text-xs text-zinc-500">生成 {generatedAt}</span>
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'ja' ? 'en' : 'ja'))}
            className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
            title="表示言語を切替"
          >
            {lang === 'ja' ? '日本語' : 'EN'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="shrink-0">レベル</span>
            <div className="inline-flex overflow-hidden rounded border border-zinc-700">
              {(
                [
                  ['all', '全体'],
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
            <span className="shrink-0">並び替え</span>
            <div className="inline-flex overflow-hidden rounded border border-zinc-700">
              {(
                [
                  ['place', '平均順位'],
                  ['top4', 'Top4率'],
                  ['win', '1位率'],
                  ['pick', 'Pick率'],
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
            <span className="shrink-0">最小サンプル</span>
            <input
              type="range"
              min={0}
              max={100}
              value={baseMinSample}
              onChange={(e) => setMinSample(Number(e.target.value))}
              className="w-48 accent-amber-400"
            />
            <span className="w-8 text-right tabular-nums text-zinc-100">
              {baseMinSample}
            </span>
            {selection.length > 0 && appliedMinSample !== baseMinSample && (
              <span className="text-xs text-amber-300/80">
                紋章選択中: 最小 {appliedMinSample}
              </span>
            )}
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[400px] shrink-0 overflow-y-auto border-r border-zinc-800 p-3">
          <h2 className="mb-2 text-sm font-semibold text-zinc-400">紋章</h2>
          <EmblemGrid
            emblems={stats.emblems}
            counts={counts}
            lang={lang}
            onAdd={addEmblem}
            onRemove={removeEmblem}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <SelectionBar emblems={stats.emblems} counts={counts} lang={lang} onClear={clear} />
          <CompList
            stats={stats}
            comps={selectedComps}
            sel={selection}
            sortKey={sortKey}
            minSample={appliedMinSample}
            lang={lang}
          />
        </main>
      </div>
    </div>
  )
}

export default App
