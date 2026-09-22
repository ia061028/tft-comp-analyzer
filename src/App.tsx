import { useEffect, useMemo, useRef, useState } from 'react'
import type { StatsFile } from '../shared/types'
import { t, type Lang } from './lib/i18n'
import { loadStats, remapSelection, DEFAULT_STATS_FILE, ALL_PATCHES_KEY } from './lib/data'
import { maxEmblemMultiplicity } from './lib/multiset'
import { DIM_SAMPLE_MAX, effectiveUnits } from './lib/format'
import { EmblemDock } from './components/EmblemDock'
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
  // 表示中（または読み込み中）のパッチビューのファイル名。既定は stats.json（集計側の既定パッチ）。
  const [patchFile, setPatchFile] = useState<string>(DEFAULT_STATS_FILE)
  // 既に表示中のデータがある状態で別パッチへ切り替えている間 true（旧データは出したまま）。
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  // ファイルごとの復元済みデータ。パッチを行き来しても再 fetch しない。
  const cacheRef = useRef(new Map<string, StatsFile>())
  // 表示中の stats への参照。切替時に紋章選択を新ファイルのインデックスへ写すのに使う。
  const shownRef = useRef<StatsFile | null>(null)

  const [selection, setSelection] = useState<number[]>([])
  // 既定は平均順位。同点は 1位率 → Top4率 の順で決まる（CompList の PRIORITY）。
  const [sortKey, setSortKey] = useState<SortKey>('place')
  // 採用数の下限フィルタは廃止した（紋章を2枚以上使う構成がほぼ全部そこで消えていた）。
  // 代わりに薄い行を「淡く描くだけ」のトグル。既定 ON で見た目は従来に近く、OFF で全部が等価に出る。
  const [dimLowSample, setDimLowSample] = useState(true)
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    return saved === 'ja' || saved === 'en' ? saved : 'ja'
  })
  const [size, setSize] = useState<SizeKey>('all')
  // モバイルの紋章シート。ドックの帯から1タップで選べるので、既定は閉じたまま。
  const [sheetOpen, setSheetOpen] = useState(false)
  // モバイルのフィルタ。開いたままだと 844px のうち 172px を占めるので、既定は畳んでおく。
  // 48rem 以上では常に開いた状態で出す（CSS 側で無視される）。
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bronzeMode, setBronzeMode] = useState(false)
  // 特性ラダー（ゲーム内機構）用: 発動している特性の種類数でまとめる。生涯ブロンズとは
  // 数える対象が違うだけの近い軸なので、同時に ON にしても意味がない。片方を押すと他方は切る。
  const [ladderMode, setLadderMode] = useState(false)

  useEffect(() => {
    let cancelled = false
    const apply = (stats: StatsFile) => {
      const prev = shownRef.current
      // 紋章 intern はファイルごとに異なるので、選択を apiName 経由で写す。
      if (prev && prev !== stats) setSelection((s) => remapSelection(s, prev.emblems, stats.emblems))
      shownRef.current = stats
      setLoad({ status: 'ready', stats })
      setSwitching(false)
      // switchError はここでは消さない。切替失敗時は元ファイル（キャッシュ済み）へ戻す際に
      // この apply が走るので、消すとエラー表示が一瞬で消えてしまう。クリック時に消す。
    }
    const cached = cacheRef.current.get(patchFile)
    if (cached) {
      apply(cached)
      return
    }
    const initial = shownRef.current === null
    if (initial) setLoad({ status: 'loading' })
    else setSwitching(true)
    loadStats(patchFile)
      .then((stats) => {
        if (cancelled) return
        cacheRef.current.set(patchFile, stats)
        apply(stats)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        if (shownRef.current === null) {
          setLoad({ status: 'error', message })
        } else {
          // 切替失敗: 表示中のデータを保持し、選択もそのファイルへ戻す。
          setSwitching(false)
          setSwitchError(message)
          const back = shownRef.current
          setPatchFile(back.patches.find((p) => p.key === back.patch)?.file ?? DEFAULT_STATS_FILE)
        }
      })
    return () => {
      cancelled = true
    }
  }, [patchFile, reloadKey])

  // 表示言語を localStorage に同期し、<html lang> も更新する。
  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const statsOrNull = load.status === 'ready' ? load.stats : null

  // 盤面サイズでフィルタ。ユニット数ではなく実効盤面サイズ（エルダードラゴンのような
  // 複数枠ユニットを枠数で数えた値）で切る。ラベルが「盤面サイズ」なので、
  // 9 を選んだら実際に9枠埋まる構成が出るのが期待どおり。
  const selectedComps = useMemo(() => {
    if (!statsOrNull) return []
    return size === 'all'
      ? statsOrNull.comps
      : statsOrNull.comps.filter((c) => effectiveUnits(c) === Number(size))
  }, [statsOrNull, size])

  // 紋章ごとの「データ上1レコードで同時活用された最大枚数」。選択枚数がこれを超えたら
  // SelectionBar で警告する（構成全体が対象。ユニット数フィルタの影響を受けない）。
  const maxMult = useMemo(
    () => (statsOrNull ? maxEmblemMultiplicity(statsOrNull.comps, statsOrNull.emblems.length) : []),
    [statsOrNull],
  )

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

  // パッチ選択肢。集計側が全ファイルに同じ一覧を埋め込んでいる。1件以下なら選択 UI は出さない。
  const patchOptions = stats.patches.map((p) => ({
    key: p.file,
    label: p.key === ALL_PATCHES_KEY ? t(lang, 'all') : p.label,
  }))
  const currentPatchFile = stats.patches.find((p) => p.key === stats.patch)?.file ?? patchFile

  // 畳んだフィルタ帯に出す今の値。ラベルは付けず、値だけを並べる。
  const shownPatchFile = switching ? patchFile : currentPatchFile
  const summary = [
    `Set ${stats.setNumber}`,
    patchOptions.find((o) => o.key === shownPatchFile)?.label,
    size === 'all' ? t(lang, 'all') : t(lang, 'unitsGroup', { n: Number(size) }),
    { place: t(lang, 'sortTier'), win: t(lang, 'sortWin'), top4: t(lang, 'sortTop4'), adopt: t(lang, 'sortAdopt') }[sortKey],
  ].filter(Boolean) as string[]

  return (
    <div className="mx-auto flex h-screen w-full max-w-[1480px] flex-col">
      {/* タイトル＆情報ヘッダー */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5 md:px-5 md:py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-5 w-1 shrink-0 rounded-full bg-gold" aria-hidden />
          <h1 className="truncate text-base font-extrabold tracking-tight text-ink md:text-lg">
            {t(lang, 'title')}
          </h1>
        </div>
        {/* セットとパッチはモバイルでは畳んだフィルタ帯に出るので、ここでは出さない。 */}
        <div className="hidden items-center gap-2 md:flex">
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

      {/* スティッキー・フィルタツールバー。モバイルでは畳んで、今の値だけを1行で出す。 */}
      <div className="sticky top-0 z-10 border-b border-line bg-base/85 px-4 py-2 backdrop-blur-md md:px-5 md:py-2.5">
        {/*
         * 畳んだ帯。開いたままだと 844px の画面で 172px を占め、肝心の一覧が半分以下になる。
         * 値そのものを並べるだけで、何のフィルタかは開けば分かる。
         */}
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-label={t(lang, 'filters')}
          className="flex w-full items-center gap-1.5 text-left md:hidden"
        >
          {summary.map((v) => (
            <span
              key={v}
              className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-inset ring-line"
            >
              {v}
            </span>
          ))}
          {ladderMode && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden />}
          {bronzeMode && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bronze" aria-hidden />}
          {dimLowSample && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink" aria-hidden />}
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            className={`ml-auto h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-150 ${filtersOpen ? 'rotate-180' : ''}`}
          >
            <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div
          className={`${filtersOpen ? 'flex' : 'hidden'} flex-wrap items-center gap-x-6 gap-y-2.5 pt-2.5 md:flex md:pt-0`}
        >
          {patchOptions.length > 1 && (
            <div className="flex items-center gap-2.5 text-sm">
              <span
                className="cursor-help text-xs font-semibold uppercase tracking-wide text-faint"
                title={t(lang, 'patchTitle')}
              >
                {t(lang, 'patch')}
              </span>
              <SegmentedControl<string>
                ariaLabel={t(lang, 'patch')}
                value={switching ? patchFile : currentPatchFile}
                onChange={(file) => {
                  setSwitchError(null)
                  setPatchFile(file)
                }}
                options={patchOptions}
              />
              {switching && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-gold"
                  aria-label={t(lang, 'loading')}
                  role="status"
                />
              )}
              {switchError && !switching && (
                <span className="text-xs text-red-400/80" role="alert" title={switchError}>
                  {t(lang, 'patchLoadFailed')}
                </span>
              )}
            </div>
          )}

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
            <span
              className="cursor-help text-xs font-semibold uppercase tracking-wide text-faint"
              title={t(lang, 'sortHint')}
            >
              {t(lang, 'sort')}
            </span>
            <SegmentedControl<SortKey>
              ariaLabel={t(lang, 'sort')}
              value={sortKey}
              onChange={setSortKey}
              options={[
                { key: 'place', label: t(lang, 'sortTier') },
                { key: 'win', label: t(lang, 'sortWin') },
                { key: 'top4', label: t(lang, 'sortTop4') },
                { key: 'adopt', label: t(lang, 'sortAdopt') },
              ]}
            />
          </div>

          {/*
           * 特性ラダー。発動している特性の**種類数**が多い順にまとめ、同じ種類数の中は
           * 選んだ指標（既定は Tier）で並べる。金は紋章の色だが、この軸はブロンズと対になる
           * ので、あちらの銅に対してこちらは金で区別する。
           */}
          <button
            type="button"
            aria-pressed={ladderMode}
            onClick={() => {
              setLadderMode((l) => !l)
              setBronzeMode(false)
            }}
            title={t(lang, 'ladderModeTitle')}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
              ladderMode
                ? 'border-gold bg-gold text-base shadow-sm'
                : 'border-line bg-surface-2 text-muted hover:border-gold/60 hover:text-ink'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${ladderMode ? 'bg-base' : 'bg-gold'}`}
              aria-hidden
            />
            {t(lang, 'ladderMode')}
          </button>

          <button
            type="button"
            aria-pressed={bronzeMode}
            onClick={() => {
              setBronzeMode((b) => !b)
              setLadderMode(false)
            }}
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

          {/*
           * 「少数を薄く」。以前はここが「採用数下限」の入力欄で、既定の 5 が複数紋章の構成を
           * ほぼ全部消していた。行は常に全部出し、薄いものを淡くするかどうかだけを選ばせる。
           */}
          <button
            type="button"
            aria-pressed={dimLowSample}
            onClick={() => setDimLowSample((d) => !d)}
            title={t(lang, 'dimLowSampleTitle', { n: DIM_SAMPLE_MAX })}
            className={`ml-auto inline-flex items-center gap-1.5 rounded-md border bg-surface-2 px-3 py-1 text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
              dimLowSample
                ? 'border-line-strong text-ink'
                : 'border-line text-faint hover:border-line-strong hover:text-muted'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${dimLowSample ? 'bg-ink' : 'bg-faint'}`}
              aria-hidden
            />
            {t(lang, 'dimLowSample')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* デスクトップのレール。モバイルは下の EmblemDock（ドック＋シート）に置き換わる。 */}
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-line bg-surface/40 p-4 md:block">
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
            maxMult={maxMult}
          />
          <CompList
            stats={stats}
            comps={selectedComps}
            sel={selection}
            sortKey={sortKey}
            dimLowSample={dimLowSample}
            lang={lang}
            bronzeMode={bronzeMode}
            ladderMode={ladderMode}
          />
        </main>
      </div>

      {/* モバイルの紋章選択面。48rem 以上では CSS 側で消える。 */}
      <EmblemDock
        emblems={stats.emblems}
        counts={counts}
        lang={lang}
        onAdd={addEmblem}
        onRemove={removeEmblem}
        onClear={clear}
        baseItemIcons={stats.baseItemIcons}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      {/* Riot の Legal Jibber Jabber。ポリシー上「プレイヤーが見つけやすい場所」への掲示が必須。 */}
      <footer className="shrink-0 border-t border-line bg-surface px-4 py-1.5 sm:px-5 sm:py-2">
        <p className="text-[10px] leading-tight text-faint sm:text-xs sm:leading-snug">{t(lang, 'legal')}</p>
      </footer>
    </div>
  )
}

export default App
