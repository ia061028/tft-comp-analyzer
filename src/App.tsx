import { useEffect, useMemo, useState } from 'react'
import type { StatsFile } from '../shared/types'
import { t, type Lang } from './lib/i18n'
import { loadStats } from './lib/data'
import { EmblemGrid } from './components/EmblemGrid'
import { SelectionBar } from './components/SelectionBar'
import { CompList } from './components/CompList'
import { SegmentedControl } from './components/SegmentedControl'
import type { SortKey } from './components/CompCard'

type SizeKey = 'all' | '7' | '8' | '9' | '10'
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stats: StatsFile }

const LANG_STORAGE_KEY = 'tft-lang'

function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  const [selection, setSelection] = useState<number[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('top4')
  const [minAdopt, setMinAdopt] = useState(5)
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    return saved === 'ja' || saved === 'en' ? saved : 'ja'
  })
  const [size, setSize] = useState<SizeKey>('all')
  const [bronzeMode, setBronzeMode] = useState(false)
  const [strict, setStrict] = useState(false)

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

  // 表示言語を localStorage に同期し、<html lang> も更新する。
  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const statsOrNull = load.status === 'ready' ? load.stats : null

  // 盤面ユニット数でフィルタ。stats/size が変わらない限り再計算しない。
  const selectedComps = useMemo(() => {
    if (!statsOrNull) return []
    return size === 'all' ? statsOrNull.comps : statsOrNull.comps.filter((c) => c.units.length === Number(size))
  }, [statsOrNull, size])

  // selection は emblems 配列インデックスのマルチセット。counts[index] = 個数。
  const counts = useMemo(() => {
    if (!statsOrNull) return []
    const c = statsOrNull.emblems.map(() => 0)
    for (const idx of selection) c[idx] = (c[idx] ?? 0) + 1
    return c
  }, [statsOrNull, selection])

  if (load.status === 'loading') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-gold"
          aria-hidden
        />
        <span className="text-sm">{t(lang, 'loading')}</span>
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-4 text-muted">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-line bg-surface p-6 text-center shadow-xl">
          <svg
            className="h-9 w-9 text-gold"
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
          <p className="text-sm font-semibold text-ink">{t(lang, 'loadFailed')}</p>
          <p className="break-all text-xs text-red-400/80">{load.message}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: 'loading' })
              setReloadKey((k) => k + 1)
            }}
            className="mt-2 rounded-md border border-line-strong bg-surface-2 px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:border-faint hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            {t(lang, 'retry')}
          </button>
        </div>
      </div>
    )
  }

  const stats = load.stats

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

  const selectedCount = selection.length

  return (
    <div className="mx-auto flex h-screen w-full max-w-[1480px] flex-col">
      {/* タイトル＆情報ヘッダー */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-1 rounded-full bg-gold" aria-hidden />
          <h1 className="text-lg font-extrabold tracking-tight text-ink">{t(lang, 'title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-inset ring-line">
            Set {stats.setNumber}
          </span>
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-inset ring-line">
            Patch {stats.tftPatch ?? stats.patch}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <div className="hidden flex-col items-end sm:flex">
            <span className="font-semibold text-muted">
              {t(lang, 'matchesCount', { n: stats.totals.matches.toLocaleString() })}
            </span>
            <span className="text-[10px] text-faint">{t(lang, 'generated', { time: generatedAt })}</span>
          </div>
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'ja' ? 'en' : 'ja'))}
            className="flex h-8 items-center justify-center rounded-md border border-line bg-surface-2 px-3 font-semibold text-ink transition-colors hover:border-line-strong hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            title={t(lang, 'langSwitchTitle')}
          >
            {lang === 'ja' ? 'EN' : 'JP'}
          </button>
        </div>
      </header>

      {/* スティッキー・フィルタツールバー */}
      <div className="sticky top-0 z-10 border-b border-line bg-base/85 px-5 py-2.5 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <div className="flex items-center gap-2.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t(lang, 'boardSize')}</span>
            <SegmentedControl<SizeKey>
              ariaLabel={t(lang, 'boardSize')}
              value={size}
              onChange={setSize}
              options={[
                { key: 'all', label: t(lang, 'all') },
                { key: '7', label: '7' },
                { key: '8', label: '8' },
                { key: '9', label: '9' },
                { key: '10', label: '10' },
              ]}
            />
          </div>

          <div className="flex items-center gap-2.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t(lang, 'sort')}</span>
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

          <button
            type="button"
            aria-pressed={bronzeMode}
            onClick={() => setBronzeMode((b) => !b)}
            title={t(lang, 'bronzeModeTitle')}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
              bronzeMode
                ? 'border-bronze bg-bronze text-base shadow-sm'
                : 'border-line bg-surface-2 text-muted hover:border-bronze/60 hover:text-ink'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${bronzeMode ? 'bg-base' : 'bg-bronze'}`}
              aria-hidden
            />
            {t(lang, 'bronzeMode')}
          </button>

          <button
            type="button"
            aria-pressed={strict}
            onClick={() => setStrict((s) => !s)}
            title={t(lang, 'strictModeTitle')}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
              strict
                ? 'border-gold bg-gold text-base shadow-sm'
                : 'border-line bg-surface-2 text-muted hover:border-gold/60 hover:text-ink'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${strict ? 'bg-base' : 'bg-gold'}`}
              aria-hidden
            />
            {t(lang, 'strictMode')}
          </button>

          <div className="ml-auto flex items-center gap-2.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-faint">{t(lang, 'adoptionRate')}</span>
            <input
              type="number"
              min={0}
              value={minAdopt}
              onChange={(e) => setMinAdopt(Math.max(0, Number(e.target.value)))}
              aria-label={t(lang, 'adoptionRate')}
              className="w-16 rounded-md border border-line bg-surface-2 px-2 py-1 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-line bg-surface/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-faint">
              {t(lang, 'emblems')}
              {selectedCount > 0 && <span className="ml-1.5 text-gold">{selectedCount}</span>}
            </h2>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={clear}
                className="text-xs font-medium text-faint transition-colors hover:text-ink"
              >
                {t(lang, 'clear')}
              </button>
            )}
          </div>
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
            bronzeMode={bronzeMode}
            strict={strict}
          />
        </main>
      </div>
    </div>
  )
}

export default App
