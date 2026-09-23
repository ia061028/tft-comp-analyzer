import { useEffect, useMemo, useState } from 'react'
import type { WireSummaryFile } from '../shared/types'
import { t, type Lang } from './lib/i18n'
import { ALL_PATCHES_KEY } from './lib/data'
import {
  defaultDir,
  emblemRows,
  loadSummary,
  noEmblemRow,
  placeTone,
  sortRows,
  traitRows,
  type StatRow,
  type StatSortKey,
  type TraitSplit,
} from './lib/summary'
import { SegmentedControl } from './components/SegmentedControl'
import { SiteNav } from './components/SiteNav'

type Tab = 'emblems' | 'traits'
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; file: WireSummaryFile }

const LANG_STORAGE_KEY = 'tft-lang'

const TONE_CLASS = { hot: 'text-ember-hot', warm: 'text-ember-warm', cold: 'text-ember-cold' } as const
/** 特性の段の数字の色（TFT の style 値: 1=ブロンズ 2=シルバー 3=ゴールド 4=プリズム）。 */
const STYLE_CLASS: Record<number, string> = {
  1: 'text-tier-bronze',
  2: 'text-tier-silver',
  3: 'text-tier-gold',
  4: 'text-tier-prism',
}

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
 * 並び順は縮約した平均順位（採用が少ないことでは下げない）。採用率は別の列で見せる。
 */
export default function StatsPage() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [lang, setLang] = useState<Lang>(readLang)
  const [viewKey, setViewKey] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('emblems')
  const [split, setSplit] = useState<TraitSplit>('all')
  const [includeUnique, setIncludeUnique] = useState(true)
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
  const view = file ? (file.views.find((v) => v.key === (viewKey ?? file.defaultKey)) ?? file.views[0]) : null

  const rows = useMemo(() => {
    if (!file || !view) return []
    const base = tab === 'emblems' ? emblemRows(file, view, lang) : traitRows(file, view, lang, split, includeUnique)
    return sortRows(base, sortKey, sortDir, lang)
  }, [file, view, tab, split, includeUnique, sortKey, sortDir, lang])
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
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2.5 border-b border-line bg-base/85 px-4 py-2 backdrop-blur-md md:px-5 md:py-2.5">
          {file.views.length > 1 && (
            <div className="flex items-center gap-2.5 text-sm">
              <span className="text-xs font-semibold tracking-wide text-faint" title={t(lang, 'patchTitle')}>
                {t(lang, 'patch')}
              </span>
              <SegmentedControl<string>
                ariaLabel={t(lang, 'patch')}
                value={view.key}
                onChange={setViewKey}
                options={file.views.map((v) => ({
                  key: v.key,
                  label: v.key === ALL_PATCHES_KEY ? t(lang, 'all') : v.label,
                }))}
              />
            </div>
          )}
          <SegmentedControl<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { key: 'emblems', label: t(lang, 'statsEmblems') },
              { key: 'traits', label: t(lang, 'statsTraits') },
            ]}
          />
          {tab === 'traits' && (
            <>
              <SegmentedControl<TraitSplit>
                value={split}
                onChange={setSplit}
                options={[
                  { key: 'all', label: t(lang, 'statsSplitAll') },
                  { key: 'with', label: t(lang, 'statsSplitWith') },
                  { key: 'without', label: t(lang, 'statsSplitWithout') },
                ]}
              />
              <SegmentedControl<'in' | 'out'>
                value={includeUnique ? 'in' : 'out'}
                onChange={(k) => setIncludeUnique(k === 'in')}
                options={[
                  { key: 'in', label: t(lang, 'statsUniqueIn') },
                  { key: 'out', label: t(lang, 'statsUniqueOut') },
                ]}
              />
            </>
          )}
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
}

function StatsTable({ rows, refRow, nameLabel, sortKey, sortDir, onSort, lang }: StatsTableProps) {
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
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          {refRow && <Row r={refRow} muted />}
        </tbody>
      </table>
    </div>
  )
}

function Row({ r, muted = false }: { r: StatRow; muted?: boolean }) {
  const pct = (v: number) => `${v.toFixed(1)}%`
  return (
    <tr className={`border-t border-line first:border-t-0 ${muted ? 'bg-base text-faint' : ''}`}>
      <td className="px-2.5 py-1.5">
        <span className="flex items-center gap-2">
          {r.icon ? (
            <img
              src={r.icon}
              alt=""
              width={20}
              height={20}
              loading="lazy"
              className="h-5 w-5 shrink-0"
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            />
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden />
          )}
          <span className={`whitespace-nowrap ${muted ? '' : 'font-medium text-ink'}`}>{r.name}</span>
          {r.min !== undefined && (
            <span className={`font-bold ${r.style ? STYLE_CLASS[r.style] : 'text-muted'}`}>{r.min}</span>
          )}
        </span>
      </td>
      <td className={`px-2.5 py-1.5 text-right font-bold ${muted ? '' : TONE_CLASS[placeTone(r.avg)]}`}>
        {r.avg.toFixed(2)}
      </td>
      <td className="px-2.5 py-1.5 text-right">{pct(r.top4)}</td>
      <td className="px-2.5 py-1.5 text-right">{pct(r.win)}</td>
      <td className="px-2.5 py-1.5 text-right">{r.lv.toFixed(2)}</td>
      <td className="px-2.5 py-1.5 text-right text-muted" title={r.n.toLocaleString()}>
        {r.share < 1 ? `${r.share.toFixed(2)}%` : pct(r.share)}
      </td>
    </tr>
  )
}
