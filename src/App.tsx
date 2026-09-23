import { useEffect, useMemo, useRef, useState } from 'react'
import type { StatsFile } from '../shared/types'
import { t, type Lang } from './lib/i18n'
import { loadStats, remapSelection, DEFAULT_STATS_FILE, ALL_PATCHES_KEY } from './lib/data'
import { maxEmblemMultiplicity } from './lib/multiset'
import { effectiveUnits } from './lib/format'
import { cycleMark, filterByUnits, type PickTab, type UnitMark } from './lib/unitFilter'
import { EmblemDock } from './components/EmblemDock'
import { EmblemGrid } from './components/EmblemGrid'
import { UnitGrid } from './components/UnitGrid'
import { CompList } from './components/CompList'
import { SegmentedControl } from './components/SegmentedControl'
import { SiteNav } from './components/SiteNav'
import type { SortKey } from './lib/format'

type SizeKey = 'all' | '7' | '8' | '9' | '10'
/** 一覧の第1キー。特性ラダーと生涯ブロンズは同時に立たないので1つの選択にする。 */
type GroupKey = 'none' | 'ladder' | 'bronze'
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
  // チャンピオンの印（apiName → 使う／使わない）。紋章の選択に重ねて構成を絞る。
  const [unitMarks, setUnitMarks] = useState<Map<string, UnitMark>>(() => new Map())
  const [pickTab, setPickTab] = useState<PickTab>('emblem')
  // 既定は平均順位。同点は 1位率 → Top4率 の順で決まる（CompList の PRIORITY）。
  const [sortKey, setSortKey] = useState<SortKey>('place')
  // 採用数の下限フィルタは廃止した（紋章を2枚以上使う構成がほぼ全部そこで消えていた）。
  // 代わりに薄い行を「淡く描くだけ」のトグル。既定 ON で見た目は従来に近く、OFF で全部が等価に出る。
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
  // 絞り込み。既定はどれも「絞らない」（採用数だけは下限 1 ＝ 全行が通る）。
  // 閾値は**画面に出ている数字**に対して効かせる（並べ替えの縮約値ではない）。
  const [minN, setMinN] = useState(1)
  const [maxPlace, setMaxPlace] = useState<number | null>(null)
  const [minTop4, setMinTop4] = useState<number | null>(null)
  const [minWin, setMinWin] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const apply = (stats: StatsFile) => {
      const prev = shownRef.current
      // 紋章 intern はファイルごとに異なるので、選択を apiName 経由で写す。
      if (prev && prev !== stats) {
        setSelection((s) => remapSelection(s, prev.emblems, stats.emblems))
        // チャンピオンの印は apiName で持つので写し替えは要らない。移行先に居ない駒の印だけ落とす
        // （タイルが出ないので外す手段が無くなる）。
        const apis = new Set(stats.units.map((u) => u.api))
        setUnitMarks((m) => {
          const kept = [...m].filter(([api]) => apis.has(api))
          return kept.length === m.size ? m : new Map(kept)
        })
      }
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
  //
  // チャンピオンの印もここで効かせる。盤面ユニットだけで決まる絞り込みなので、紋章の行
  // （compRows）を作る前に構成ごと落とせる。
  const selectedComps = useMemo(() => {
    if (!statsOrNull) return []
    const sized =
      size === 'all'
        ? statsOrNull.comps
        : statsOrNull.comps.filter((c) => effectiveUnits(c) === Number(size))
    return filterByUnits(sized, statsOrNull.units, unitMarks)
  }, [statsOrNull, size, unitMarks])

  // チャンピオンの選択面に出す駒。構成に1度も出ない駒は選んでも何も起きないので出さない。
  const pickableUnits = useMemo(() => {
    if (!statsOrNull) return []
    const seen = new Set<number>()
    for (const c of statsOrNull.comps) for (const u of c.units) seen.add(u)
    return statsOrNull.units.filter((_, i) => seen.has(i))
  }, [statsOrNull])

  // 紋章ごとの「データ上1レコードで同時活用された最大枚数」。選択枚数がこれを超えた紋章は
  // タイルの個数バッジを銅にして知らせる（構成全体が対象。ユニット数フィルタの影響を受けない）。
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
  const cycleUnit = (api: string) => setUnitMarks((m) => cycleMark(m, api))
  const unmarkUnit = (api: string) =>
    setUnitMarks((m) => {
      if (!m.has(api)) return m
      const next = new Map(m)
      next.delete(api)
      return next
    })
  const clearUnits = () => setUnitMarks(new Map())

  const generatedAt = new Date(stats.generatedAt).toLocaleString()

  const selectedCount = selection.length
  const markedCount = unitMarks.size
  // 紋章とチャンピオンの切り替え（レールとドックで共用）。数は選んでいるときだけ付ける。
  const tabOptions: { key: PickTab; label: string }[] = [
    { key: 'emblem', label: selectedCount > 0 ? `${t(lang, 'emblems')} ${selectedCount}` : t(lang, 'emblems') },
    { key: 'unit', label: markedCount > 0 ? `${t(lang, 'champions')} ${markedCount}` : t(lang, 'champions') },
  ]

  // パッチ選択肢。集計側が全ファイルに同じ一覧を埋め込んでいる。1件以下なら選択 UI は出さない。
  const patchOptions = stats.patches.map((p) => ({
    key: p.file,
    label: p.key === ALL_PATCHES_KEY ? t(lang, 'all') : p.label,
  }))
  const currentPatchFile = stats.patches.find((p) => p.key === stats.patch)?.file ?? patchFile

  // 効いている絞り込みの数。畳んだ帯と「解除」の出し分けに使う。
  const activeFilters =
    (minN > 1 ? 1 : 0) + (maxPlace !== null ? 1 : 0) + (minTop4 !== null ? 1 : 0) + (minWin !== null ? 1 : 0)

  // 畳んだフィルタ帯に出す今の値。ラベルは付けず、値だけを並べる。
  const shownPatchFile = switching ? patchFile : currentPatchFile
  const summary = [
    `Set ${stats.setNumber}`,
    patchOptions.find((o) => o.key === shownPatchFile)?.label,
    size === 'all' ? t(lang, 'all') : t(lang, 'unitsGroup', { n: Number(size) }),
    { place: t(lang, 'sortTier'), win: t(lang, 'sortWin'), top4: t(lang, 'sortTop4'), adopt: t(lang, 'sortAdopt') }[sortKey],
    // 絞り込みは効いている数だけ出す。値そのものを並べると帯が2段になり、
    // 畳んでいる意味が無くなる（何で絞ったかは開けば分かる）。
    activeFilters > 0 ? `${t(lang, 'filters')} ${activeFilters}` : null,
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
        <SiteNav current="comps" lang={lang} />
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
              className="whitespace-nowrap rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-inset ring-line"
            >
              {v}
            </span>
          ))}
          {ladderMode && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden />}
          {bronzeMode && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bronze" aria-hidden />}
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
                className="cursor-help text-xs font-semibold tracking-wide text-faint"
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
            <span className="text-xs font-semibold tracking-wide text-faint">{t(lang, 'boardSize')}</span>
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
              className="cursor-help text-xs font-semibold tracking-wide text-faint"
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
           * オーグメント別の並べ方。特性ラダーも生涯ブロンズもゲーム内のオーグメントで、
           * **同時には持てない**ので、2つの独立したトグルではなく1つの選択にする。
           * 押すと相手が消えるトグルは、消えた理由が画面に出ないぶん読み取りにくい。
           *
           * 選択中の塗りは行に出る数字の色に合わせる（ラダー＝金 / ブロンズ＝銅）。
           */}
          <div className="flex items-center gap-2.5 text-sm">
            <span
              className="cursor-help text-xs font-semibold tracking-wide text-faint"
              title={t(lang, 'groupByTitle')}
            >
              {t(lang, 'groupBy')}
            </span>
            <SegmentedControl<GroupKey>
              ariaLabel={t(lang, 'groupBy')}
              value={ladderMode ? 'ladder' : bronzeMode ? 'bronze' : 'none'}
              onChange={(k) => {
                setLadderMode(k === 'ladder')
                setBronzeMode(k === 'bronze')
              }}
              options={[
                { key: 'none', label: t(lang, 'groupNone') },
                { key: 'ladder', label: t(lang, 'ladderMode'), accent: 'gold' },
                { key: 'bronze', label: t(lang, 'bronzeMode'), accent: 'bronze' },
              ]}
            />
          </div>
        </div>

        {/*
         * 絞り込みは別の段に分ける。上の段は「何を見て、どう並べるか」、この段は
         * 「何を外すか」で、手の種類が違う。1段に混ぜると、並び替えと絞り込みが
         * 同じ重さで並んで読み分けられなくなる。
         *
         * 値は自由入力ではなく決め打ちの段から選ぶ。2.47 のような刻みに意味は無く、
         * 打ち間違いで一覧が空になるだけなので、意味のある区切りだけを出す。
         */}
        <div
          className={`${filtersOpen ? 'flex' : 'hidden'} mt-2 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2 md:flex`}
        >
          <span className="text-xs font-semibold tracking-wide text-faint">
            {t(lang, 'filters')}
          </span>
          {pickField({
            id: 'min-n',
            label: t(lang, 'minSample'),
            title: t(lang, 'minSampleTitle'),
            value: minN,
            onChange: (v) => setMinN(v ?? 1),
            options: MIN_N_STEPS,
            dir: 'min',
            lang,
          })}
          {pickField({
            id: 'max-place',
            label: t(lang, 'avgPlace'),
            title: t(lang, 'maxPlaceTitle'),
            value: maxPlace,
            onChange: setMaxPlace,
            options: PLACE_STEPS,
            dir: 'max',
            fmt: (v) => v.toFixed(2),
            lang,
          })}
          {pickField({
            id: 'min-top4',
            label: t(lang, 'metricTop4'),
            title: t(lang, 'minTop4Title'),
            value: minTop4,
            onChange: setMinTop4,
            options: RATE_STEPS,
            dir: 'min',
            fmt: (v) => `${v}%`,
            lang,
          })}
          {pickField({
            id: 'min-win',
            label: t(lang, 'metricWin'),
            title: t(lang, 'minWinTitle'),
            value: minWin,
            onChange: setMinWin,
            options: WIN_STEPS,
            dir: 'min',
            fmt: (v) => `${v}%`,
            lang,
          })}
          {/* 解除は効いているときだけ出す。何も外していないときに押せる「解除」は嘘。 */}
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setMinN(1)
                setMaxPlace(null)
                setMinTop4(null)
                setMinWin(null)
              }}
              className="text-xs font-semibold text-faint underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              {t(lang, 'filterReset')}
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* デスクトップのレール。モバイルは下の EmblemDock（ドック＋シート）に置き換わる。 */}
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-line bg-surface/40 p-4 md:block">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SegmentedControl<PickTab>
              ariaLabel={t(lang, 'emblems')}
              value={pickTab}
              onChange={setPickTab}
              options={tabOptions}
            />
            {(pickTab === 'emblem' ? selectedCount : markedCount) > 0 && (
              <button
                type="button"
                onClick={pickTab === 'emblem' ? clear : clearUnits}
                className="text-xs font-medium text-faint transition-colors hover:text-ink"
              >
                {t(lang, 'clear')}
              </button>
            )}
          </div>
          {pickTab === 'emblem' ? (
            <EmblemGrid
              emblems={stats.emblems}
              counts={counts}
              lang={lang}
              onAdd={addEmblem}
              onRemove={removeEmblem}
              baseItemIcons={stats.baseItemIcons}
              maxMult={maxMult}
            />
          ) : (
            <UnitGrid
              units={pickableUnits}
              marks={unitMarks}
              lang={lang}
              onCycle={cycleUnit}
              onUnmark={unmarkUnit}
            />
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <CompList
            stats={stats}
            comps={selectedComps}
            sel={selection}
            sortKey={sortKey}
            lang={lang}
            bronzeMode={bronzeMode}
            ladderMode={ladderMode}
            minN={minN}
            maxPlace={maxPlace}
            minTop4={minTop4}
            minWin={minWin}
            unitFiltered={markedCount > 0}
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
        maxMult={maxMult}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        tab={pickTab}
        onTabChange={setPickTab}
        tabOptions={tabOptions}
        units={pickableUnits}
        unitMarks={unitMarks}
        onCycleUnit={cycleUnit}
        onUnmarkUnit={unmarkUnit}
        onClearUnits={clearUnits}
      />

      {/* Riot の Legal Jibber Jabber。ポリシー上「プレイヤーが見つけやすい場所」への掲示が必須。 */}
      <footer className="shrink-0 border-t border-line bg-surface px-4 py-1.5 sm:px-5 sm:py-2">
        <p className="text-[10px] leading-tight text-faint sm:text-xs sm:leading-snug">{t(lang, 'legal')}</p>
      </footer>
    </div>
  )
}

/**
 * 絞り込みの段。自由入力ではなく決め打ちの区切りから選ばせる。
 *
 * 平均順位は 2.00〜4.50 の 0.25 刻み（実データの行はほぼこの幅に収まる）、率は
 * 意味のある節目だけ。細かい刻みは「2.47 以下」のような、読む側に何も伝えない
 * 閾値を作るだけで、1つ打ち間違えると一覧が丸ごと消える。
 *
 * 採用数だけ「指定なし」が無い。1 ＝ 何も外れない、が既定なので同じものになる。
 */
const MIN_N_STEPS = [1, 2, 3, 5, 10, 20, 50] as const
const PLACE_STEPS = [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4, 4.5] as const
const RATE_STEPS = [50, 60, 65, 70, 75, 80, 85, 90, 95] as const
const WIN_STEPS = [10, 15, 20, 25, 30, 40, 50] as const

/**
 * 閾値の向きを言葉にする。日本語は「2.50 以下」、英語は「≤ 2.50」。
 *
 * 選択肢にも畳んだ帯にも同じ書き方を使う。片方が「≤ 2.50」で片方が「2.50 以下」だと、
 * 同じ設定を指しているのか確かめる手間が要る。
 */
function limitText(lang: Lang, dir: 'max' | 'min', n: string) {
  return lang === 'ja' ? `${n} ${dir === 'max' ? '以下' : '以上'}` : `${dir === 'max' ? '≤' : '≥'} ${n}`
}

interface PickFieldProps {
  id: string
  label: string
  title: string
  value: number | null
  onChange: (v: number | null) => void
  options: readonly number[]
  /** 向き。max ＝ この値以下だけ残す、min ＝ この値以上だけ残す。 */
  dir: 'max' | 'min'
  fmt?: (v: number) => string
  lang: Lang
}

/**
 * 絞り込みの選択1つ。「指定なし」は選択肢そのもの（= `null`）に割り当てる。
 *
 * 向き（以下／以上）は選択肢そのものに書く。ラベルに指標名だけを置いて向きを
 * 伏せると、「Top4率 80」がそれ以上なのか以下なのか画面から読めない。
 */
function pickField({ id, label, title, value, onChange, options, dir, fmt, lang }: PickFieldProps) {
  const show = (v: number) => limitText(lang, dir, fmt ? fmt(v) : String(v))
  const any = value === null
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <label
        htmlFor={id}
        title={title}
        className="cursor-help whitespace-nowrap text-xs font-semibold tracking-wide text-faint"
      >
        {label}
      </label>
      <select
        id={id}
        value={value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`rounded-md border bg-surface-2 py-1 pl-2 pr-1.5 text-sm font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
          any ? 'border-line text-faint' : 'border-line-strong text-ink'
        }`}
      >
        {/* 採用数のように 1 が既定のものは「指定なし」を出さない（同じ意味になる）。 */}
        {!options.includes(1) && <option value="">{t(lang, 'filterAny')}</option>}
        {options.map((v) => (
          <option key={v} value={v}>
            {show(v)}
          </option>
        ))}
      </select>
    </div>
  )
}

export default App
