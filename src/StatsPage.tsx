import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LevelKey, WireDrillFile, WireSummaryFile, WireSummaryView } from '../shared/types'
import { pickName, t, type Lang } from './lib/i18n'
import { ALL_PATCHES_KEY } from './lib/data'
import {
  defaultDir,
  emblemRows,
  filterView,
  loadSummary,
  noEmblemRow,
  pickRows,
  placeTone,
  sortRows,
  traitRows,
  type StatRow,
  type ChooserFilter,
  type StatSortKey,
  type TraitSplit,
} from './lib/summary'
import { drillTypes, loadDrill, type DrillType } from './lib/drill'
import { costBorder, styleClasses } from './lib/format'
import { SegmentedControl } from './components/SegmentedControl'
import { SiteNav } from './components/SiteNav'

/** 数字のタブは選択駒（summary.json の choosers の idx）。 */
type Tab = 'emblems' | 'traits' | number
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; file: WireSummaryFile }
type DrillState = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; file: WireDrillFile }

/** 「採用1%以上」で残す、表示中の参加者に対する採用の割合の下限。 */
const MIN_SHARE = 0.01

const LANG_STORAGE_KEY = 'tft-lang'

const TONE_CLASS = { hot: 'text-ember-hot', warm: 'text-ember-warm', cold: 'text-ember-cold' } as const

function readLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    return saved === 'en' ? 'en' : 'ja'
  } catch {
    return 'ja'
  }
}

/**
 * 統計ページ。紋章ごと・特性の発動段ごとの成績を、全参加者で数えた表で出す。
 *
 * 構成一覧の成績は紋章を活用した試合だけの部分集合なので、ここの数字とは母集団が違う。
 * 並び順は縮約した平均順位（採用が少ないことでは下げない）。採用数は別の列で見せる。
 */
export default function StatsPage() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [lang, setLang] = useState<Lang>(readLang)
  const [viewKey, setViewKey] = useState<string | null>(null)
  const [tabState, setTab] = useState<Tab>('emblems')
  const [split, setSplit] = useState<TraitSplit>('all')
  const [includeUnique, setIncludeUnique] = useState(true)
  const [minN, setMinN] = useState(false)
  const [level, setLevel] = useState<'all' | LevelKey>('all')
  /** 選択駒ごとの絞り込み（choosers の idx 順。足りない分は全体）。 */
  const [chooserFilters, setChooserFilters] = useState<ChooserFilter[]>([])
  /** 型を開いている特性行（行キー）。 */
  const [openRow, setOpenRow] = useState<string | null>(null)
  /** ビュー key → 掘り下げファイル。行を初めて開いたときに読む。 */
  const [drills, setDrills] = useState<Record<string, DrillState>>({})
  const [sortKey, setSortKey] = useState<StatSortKey>('avg')
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  useEffect(() => {
    let cancelled = false
    loadSummary()
      .then((file) => {
        if (cancelled) return
        setLoad(file ? { status: 'ready', file } : { status: 'missing' })
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang)
    } catch {
      // 保存できなくても表示は変わらない。
    }
    document.documentElement.lang = lang
  }, [lang])

  const file = load.status === 'ready' ? load.file : null
  const baseView = file ? (file.views.find((v) => v.key === (viewKey ?? file.defaultKey)) ?? file.views[0]) : null
  // 選択駒の切り替えは、区分（cells）を持つファイルでだけ出す。
  const choosers = useMemo(() => (baseView?.cells ? (file?.choosers ?? []) : []), [baseView, file])
  // 選択駒の無いビューへ移ったら、選択駒のタブは紋章に戻す。
  const tab: Tab = typeof tabState === 'number' && tabState >= choosers.length ? 'emblems' : tabState
  const cf = useMemo(() => choosers.map((_, i) => chooserFilters[i] ?? 'all'), [choosers, chooserFilters])
  const filtered = cf.some((f) => f !== 'all')
  const hasLevels = !!(baseView?.cells || baseView?.levels)
  const view: WireSummaryView | null = useMemo(
    () => (baseView ? filterView(baseView, hasLevels ? level : 'all', cf) : null),
    [baseView, hasLevels, level, cf],
  )

  const rows = useMemo(() => {
    if (!file || !view) return []
    const base =
      tab === 'emblems'
        ? emblemRows(file, view, lang)
        : tab === 'traits'
          ? traitRows(file, view, lang, split, includeUnique)
          : pickRows(file, view, tab, lang)
    const min = view.participants * MIN_SHARE
    return sortRows(minN ? base.filter((r) => r.n >= min) : base, sortKey, sortDir, lang)
  }, [file, view, tab, split, includeUnique, minN, sortKey, sortDir, lang])

  const drillKey = view ? (hasLevels && level !== 'all' ? `${view.key}-lv${level}` : view.key) : null
  // 構成の型は全参加者（とレベル）でしか作っていないので、選択駒で絞っている間は開けない。
  const drillable = tab === 'traits' && !filtered
  const drill = drillKey ? drills[drillKey] : undefined
  /** 型を開くときに、そのビューの掘り下げファイルをまだ読んでいなければ読む。 */
  const ensureDrill = (key: string | null) => {
    if (!key || drills[key]) return
    setDrills((d) => ({ ...d, [key]: { status: 'loading' } }))
    loadDrill(key)
      .then((f) => setDrills((d) => ({ ...d, [key]: f ? { status: 'ready', file: f } : { status: 'missing' } })))
      .catch(() => setDrills((d) => ({ ...d, [key]: { status: 'error' } })))
  }
  const toggleRow = (key: string) => {
    setOpenRow((k) => (k === key ? null : key))
    ensureDrill(drillKey)
  }
  const changeView = (key: string) => {
    setViewKey(key)
    if (openRow) ensureDrill(level === 'all' ? key : `${key}-lv${level}`)
  }
  const changeChooser = (i: number, f: ChooserFilter) =>
    setChooserFilters(choosers.map((_, k) => (k === i ? f : (cf[k] ?? 'all'))))
  const changeLevel = (lv: 'all' | LevelKey) => {
    setLevel(lv)
    if (openRow && view) ensureDrill(lv === 'all' ? view.key : `${view.key}-lv${lv}`)
  }

  const renderDrill = (r: StatRow): ReactNode => {
    if (!drill || drill.status === 'loading') return <p className="text-xs text-faint">{t(lang, 'loading')}</p>
    if (drill.status === 'error') return <p className="text-xs text-red-400/80">{t(lang, 'loadFailed')}</p>
    if (drill.status === 'missing') return <p className="text-xs text-faint">{t(lang, 'drillNotReady')}</p>
    const [api] = r.key.split('|')
    return <DrillPanel types={drillTypes(drill.file, file!, api, r.min!, split, lang)} lang={lang} />
  }
  const refRow = tab === 'emblems' && view ? noEmblemRow(view, t(lang, 'statsNoEmblem')) : null

  const onSort = (key: StatSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setSortDir(defaultDir(key))
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5 md:px-5 md:py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-5 w-1 shrink-0 rounded-full bg-gold" aria-hidden />
          <h1 className="truncate text-base font-extrabold tracking-tight text-ink md:text-lg">{t(lang, 'title')}</h1>
        </div>
        <SiteNav current="stats" lang={lang} />
        <div className="ml-auto flex items-center gap-4 text-xs">
          {view && (
            <div className="hidden flex-col items-end sm:flex">
              <span className="font-semibold text-muted">
                {t(lang, 'matchesCount', { n: view.matches.toLocaleString() })}
              </span>
              <span className="text-[10px] text-faint">
                {t(lang, 'generated', { time: new Date(file!.generatedAt).toLocaleString() })}
              </span>
            </div>
          )}
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

      {file && view && (
        <div className="sticky top-0 z-10 border-b border-line bg-base/85 backdrop-blur-md">
          {/*
           * 紋章／特性は「何の表を見るか」で、下の絞り込みとは手の種類が違う。同じ見た目の
           * ボタンを並べると読み分けられないので、表の切り替えだけタブにして一段上に置く。
           */}
          <div role="tablist" className="flex gap-1 px-4 md:px-5">
            {(
              [
                ['emblems', t(lang, 'statsEmblems')],
                ['traits', t(lang, 'statsTraits')],
                ...choosers.map((c, i) => [i, pickName(lang, c)] as const),
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
                  tab === key ? 'border-gold text-ink' : 'border-transparent text-faint hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-2 md:px-5">
            {file.views.length > 1 && (
              <div className="flex items-center gap-2.5 text-sm">
                <span className="text-xs font-semibold tracking-wide text-faint" title={t(lang, 'patchTitle')}>
                  {t(lang, 'patch')}
                </span>
                <SegmentedControl<string>
                  ariaLabel={t(lang, 'patch')}
                  value={view.key}
                  onChange={changeView}
                  options={file.views.map((v) => ({
                    key: v.key,
                    label: v.key === ALL_PATCHES_KEY ? t(lang, 'all') : v.label,
                  }))}
                />
              </div>
            )}
            {hasLevels && (
              <SegmentedControl<'all' | LevelKey>
                ariaLabel={t(lang, 'statsLevel')}
                value={level}
                onChange={changeLevel}
                options={[
                  { key: 'all', label: t(lang, 'statsLevelAll') },
                  { key: '7', label: t(lang, 'statsLevelLow') },
                  { key: '8', label: '8' },
                  { key: '9', label: '9' },
                  { key: '10', label: '10' },
                ]}
              />
            )}
            {choosers.map((c, i) => (
              <div key={c.api} className="flex items-center gap-1.5">
                <img
                  src={c.icon}
                  alt={pickName(lang, c)}
                  title={pickName(lang, c)}
                  loading="lazy"
                  className="h-7 w-7 rounded-full border border-line object-cover"
                  onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                />
                <SegmentedControl<ChooserFilter>
                  ariaLabel={pickName(lang, c)}
                  value={cf[i]}
                  onChange={(f) => changeChooser(i, f)}
                  options={[
                    { key: 'all', label: t(lang, 'statsSplitAll') },
                    { key: 'with', label: t(lang, 'statsChooserWith') },
                    { key: 'without', label: t(lang, 'statsChooserWithout') },
                  ]}
                />
              </div>
            ))}
            {/* 狭い画面ではパッチの右に収まり、絞り込みが2段で済む位置。 */}
            <ToggleButton pressed={minN} onClick={() => setMinN((v) => !v)}>
              {t(lang, 'statsMinN')}
            </ToggleButton>
            {tab === 'traits' && (
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl<TraitSplit>
                  value={split}
                  onChange={setSplit}
                  options={[
                    { key: 'all', label: t(lang, 'statsSplitAll') },
                    { key: 'with', label: t(lang, 'statsSplitWith') },
                    { key: 'without', label: t(lang, 'statsSplitWithout') },
                  ]}
                />
                {/* 含む／除くの2択は片方が既定なので、1つの切り替えボタンにする。 */}
                <ToggleButton pressed={!includeUnique} onClick={() => setIncludeUnique((v) => !v)}>
                  {t(lang, 'statsUniqueOut')}
                </ToggleButton>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 p-4">
        {load.status === 'loading' && <p className="text-sm text-faint">{t(lang, 'loading')}</p>}
        {load.status === 'missing' && <p className="text-sm text-faint">{t(lang, 'statsNotReady')}</p>}
        {load.status === 'error' && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-red-400/80" title={load.message}>
              {t(lang, 'loadFailed')}
            </span>
            <button
              type="button"
              onClick={() => {
                setLoad({ status: 'loading' })
                setReloadKey((k) => k + 1)
              }}
              className="rounded-md border border-line bg-surface-2 px-3 py-1 font-semibold text-ink hover:border-line-strong"
            >
              {t(lang, 'retry')}
            </button>
          </div>
        )}
        {view && (
          <StatsTable
            rows={rows}
            refRow={refRow}
            nameLabel={t(lang, tab === 'emblems' ? 'statsEmblem' : 'statsTrait')}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            lang={lang}
            openRow={drillable ? openRow : null}
            onToggleRow={drillable ? toggleRow : undefined}
            renderDetail={renderDrill}
          />
        )}
      </main>

      {/* Riot の Legal Jibber Jabber。ポリシー上「プレイヤーが見つけやすい場所」への掲示が必須。 */}
      <footer className="shrink-0 border-t border-line bg-surface px-4 py-1.5 sm:px-5 sm:py-2">
        <p className="text-[10px] leading-tight text-faint sm:text-xs sm:leading-snug">{t(lang, 'legal')}</p>
      </footer>
    </div>
  )
}

interface StatsTableProps {
  rows: StatRow[]
  refRow: StatRow | null
  nameLabel: string
  sortKey: StatSortKey
  sortDir: 1 | -1
  onSort: (key: StatSortKey) => void
  lang: Lang
  /** 行を押して下に開く（特性の表だけ）。 */
  openRow: string | null
  onToggleRow?: (key: string) => void
  renderDetail: (r: StatRow) => ReactNode
}

function StatsTable({ rows, refRow, nameLabel, sortKey, sortDir, onSort, lang, openRow, onToggleRow, renderDetail }: StatsTableProps) {
  const cols: { key: StatSortKey; label: string }[] = [
    { key: 'name', label: nameLabel },
    { key: 'avg', label: t(lang, 'statsAvgPlace') },
    { key: 'top4', label: t(lang, 'statsTop4') },
    { key: 'win', label: t(lang, 'statsWin') },
    { key: 'lv', label: t(lang, 'statsLevel') },
    { key: 'share', label: t(lang, 'statsShare') },
  ]
  if (rows.length === 0) return <p className="text-sm text-faint">{t(lang, 'statsEmpty')}</p>
  return (
    <div className="max-w-3xl overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line">
            {cols.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={c.key === sortKey ? (sortDir === 1 ? 'ascending' : 'descending') : undefined}
                className={`whitespace-nowrap px-2.5 py-2 text-xs font-semibold tracking-wide ${i === 0 ? 'text-left' : 'text-right'} ${
                  c.key === sortKey ? 'text-ink' : 'text-faint'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  className="rounded hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
                >
                  {c.label}
                  {/* 押せる見出しだと分かるように、並べている列には向きを出す。 */}
                  {c.key === sortKey && <span aria-hidden className="ml-0.5">{sortDir === 1 ? '▲' : '▼'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.key}>
              <Row r={r} open={openRow === r.key} onToggle={onToggleRow ? () => onToggleRow(r.key) : undefined} />
              {openRow === r.key && (
                <tr className="border-t border-line bg-base">
                  <td colSpan={cols.length} className="p-0">
                    {/* 表は狭い画面で横に流れるので、中身は画面幅に収めて左に貼り付ける。 */}
                    <div className="sticky left-0 max-w-[calc(100vw-2rem)] p-2.5">{renderDetail(r)}</div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {refRow && <Row r={refRow} muted />}
        </tbody>
      </table>
    </div>
  )
}

function Row({ r, muted = false, open = false, onToggle }: { r: StatRow; muted?: boolean; open?: boolean; onToggle?: () => void }) {
  const pct = (v: number) => `${v.toFixed(1)}%`
  return (
    <tr
      className={`border-t border-line first:border-t-0 ${muted ? 'bg-base text-faint' : ''} ${
        onToggle ? `cursor-pointer hover:bg-surface-2 ${open ? 'bg-surface-2' : ''}` : ''
      }`}
      onClick={onToggle}
      aria-expanded={onToggle ? open : undefined}
    >
      <td className="px-2.5 py-1.5">
        <span className="flex items-center gap-2">
          {r.min !== undefined ? (
            // 構成一覧の発動特性チップと同じ見た目（段の色の枠＋アイコン＋体数）。
            // 幅は2桁の体数に合わせて固定し、右の特性名の書き出しを縦にそろえる。
            <span
              className={`inline-flex h-[20px] w-11 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold tabular-nums ${styleClasses(r.style ?? 1)}`}
            >
              {r.icon && <Icon src={r.icon} className="h-3.5 w-3.5 object-contain" />}
              {r.min}
            </span>
          ) : r.icon ? (
            <Icon src={r.icon} className="h-5 w-5 shrink-0" />
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden />
          )}
          <span className={`whitespace-nowrap ${muted ? '' : 'font-medium text-ink'}`}>{r.name}</span>
          {onToggle && (
            <span aria-hidden className={`text-[10px] text-faint transition-transform ${open ? 'rotate-180' : ''}`}>
              ▾
            </span>
          )}
        </span>
      </td>
      <td className={`px-2.5 py-1.5 text-right font-bold ${muted ? '' : TONE_CLASS[placeTone(r.avg)]}`}>
        {r.avg.toFixed(2)}
      </td>
      <td className="px-2.5 py-1.5 text-right">{pct(r.top4)}</td>
      <td className="px-2.5 py-1.5 text-right">{pct(r.win)}</td>
      <td className="px-2.5 py-1.5 text-right">{r.lv.toFixed(2)}</td>
      <td
        className="px-2.5 py-1.5 text-right text-muted"
        title={r.share < 1 ? `${r.share.toFixed(2)}%` : pct(r.share)}
      >
        {r.n.toLocaleString()}
      </td>
    </tr>
  )
}

/** 読み込めないアイコン（CDragon 側の欠け）は枠ごと消さず、場所だけ残して見えなくする。 */
function Icon({ src, className }: { src: string; className: string }) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={className}
      onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
    />
  )
}

function ToggleButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
        pressed ? 'border-gold bg-gold text-base' : 'border-line bg-surface-2 text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * 特性の段の「構成の型」。相方特性ごとに、人数・平均順位・平均Lv・最多の盤面を並べ、
 * 押すと駒ごとの採用率と星3率を開く。並びは人数順（型は採用の多さで探すので）。
 */
function DrillPanel({ types, lang }: { types: DrillType[]; lang: Lang }) {
  const [open, setOpen] = useState<string | null>(null)
  if (types.length === 0) return <p className="text-xs text-faint">{t(lang, 'statsEmpty')}</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {types.map((ty) => (
        <li key={ty.key} className="rounded-md border border-line bg-surface">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (ty.units.length > 0) setOpen((k) => (k === ty.key ? null : ty.key))
            }}
            aria-expanded={ty.units.length > 0 ? open === ty.key : undefined}
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-left text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
              {ty.partner === null ? (
                t(lang, 'drillOther')
              ) : ty.partner === undefined ? (
                t(lang, 'drillSolo')
              ) : (
                <>
                  <span aria-hidden className="text-faint">＋</span>
                  <Icon src={ty.partner.icon} className="h-4 w-4 shrink-0 object-contain" />
                  <span className="truncate">{ty.partner.name}</span>
                </>
              )}
            </span>
            <span className="ml-auto flex items-center gap-3">
              <span className={`font-bold ${TONE_CLASS[placeTone(ty.avg)]}`}>{ty.avg.toFixed(2)}</span>
              <span className="text-muted">Lv {ty.lv.toFixed(2)}</span>
              <span className="w-14 text-right text-muted" title={`${ty.share.toFixed(1)}%`}>
                {t(lang, 'statsParticipants', { n: ty.n.toLocaleString() })}
              </span>
              <span aria-hidden className={`w-2 text-[10px] text-faint ${ty.units.length === 0 ? 'invisible' : ''}`}>
                {open === ty.key ? '▴' : '▾'}
              </span>
            </span>
          </button>
          {ty.board.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-line px-2.5 py-1.5">
              {ty.board.map((u, i) => (
                <img
                  key={i}
                  src={u.icon}
                  alt={u.name}
                  title={u.name}
                  loading="lazy"
                  className={`h-7 w-7 rounded border-2 object-cover ${costBorder(u.cost)}`}
                  onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                />
              ))}
              <span className="ml-1 text-[11px] text-faint tabular-nums">
                {t(lang, 'drillBoard')} · {t(lang, 'statsParticipants', { n: ty.boardN.toLocaleString() })} ·{' '}
                {ty.boardAvg.toFixed(2)}
              </span>
            </div>
          )}
          {open === ty.key && <DrillUnits type={ty} lang={lang} />}
        </li>
      ))}
    </ul>
  )
}

function DrillUnits({ type, lang }: { type: DrillType; lang: Lang }) {
  const avg = (v: number | null) => (v === null ? '–' : v.toFixed(2))
  return (
    <div className="overflow-x-auto border-t border-line">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead>
          <tr className="text-faint">
            <th scope="col" className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold">{t(lang, 'drillUnit')}</th>
            <th scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{t(lang, 'drillUnitShare')}</th>
            <th scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{t(lang, 'drillStar3')}</th>
            <th scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{t(lang, 'drillStar3Avg')}</th>
            <th scope="col" className="whitespace-nowrap px-2.5 py-1.5 text-right font-semibold">{t(lang, 'drillOtherAvg')}</th>
          </tr>
        </thead>
        <tbody>
          {type.units.map((u) => (
            <tr key={u.api} className="border-t border-line">
              <td className="px-2.5 py-1">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <img
                    src={u.icon}
                    alt=""
                    loading="lazy"
                    className={`h-5 w-5 rounded border ${costBorder(u.cost)} object-cover`}
                    onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  />
                  <span className="text-ink">{u.name}</span>
                </span>
              </td>
              <td className="px-2 py-1 text-right text-muted">{u.share.toFixed(0)}%</td>
              <td className={`px-2 py-1 text-right font-semibold ${u.star3 >= 50 ? 'text-gold' : 'text-ink'}`}>
                {u.star3.toFixed(0)}%
              </td>
              <td className="px-2 py-1 text-right">{avg(u.star3Avg)}</td>
              <td className="px-2.5 py-1 text-right text-muted">{avg(u.otherAvg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
