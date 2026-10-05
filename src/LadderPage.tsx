import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { StatsFile } from '../shared/types'
import { pickName, t, type Lang } from './lib/i18n'
import { DEFAULT_STATS_FILE, loadStatsHead } from './lib/data'
import { activeTier, buildPlannerCode, styleClasses } from './lib/format'
import { LADDER_REWARDS, TEAM_SIZE_STEP, candidateUnits, splitGranters, type LadderData } from './lib/ladder'
import type { LadderRequest, LadderResponse, WireStep } from './lib/ladder.worker'
import { nextMark, type UnitMark } from './lib/unitFilter'
import { SegmentedControl } from './components/SegmentedControl'
import { SiteNav } from './components/SiteNav'
import { UnitGrid } from './components/UnitGrid'

const LANG_STORAGE_KEY = 'tft-lang'
/** ルート表に出すレベル。Lv4 から解説の目標（Lv10 で14段）まで。 */
const LEVELS = [4, 5, 6, 7, 8, 9, 10]
/** 紋章の判定に使うレベル。解説は「Lv8 で紋章を足して11段」を基準にしている。 */
const JUDGE_LEVEL = 8

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; stats: StatsFile }

function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'en' ? 'en' : 'ja'
  } catch {
    return 'ja'
  }
}

/**
 * 辞書を読むファイルを決める。付与元（カ＝ジックスの進化など）の推定は試合数が多いほど正しく、
 * 直近1日のような小さいビューでは別の駒に取り違えることがある（実データで ダイアナ→ラヴィジャー）。
 * なので既定ファイルの patches から、試合数が最も多いビューの辞書を使う。
 */
async function loadLadderDictionaries(): Promise<StatsFile> {
  const head = await loadStatsHead(DEFAULT_STATS_FILE)
  const biggest = [...head.patches].sort((a, b) => b.matches - a.matches)[0]
  if (!biggest || biggest.file === DEFAULT_STATS_FILE) return head
  try {
    return await loadStatsHead(biggest.file)
  } catch {
    return head
  }
}

/**
 * 特性ラダー（オーグメント）の計算機。もらった紋章とレベルから、各レベルで発動できる特性の
 * 種類数が最大になる盤面をルート表で出す。統計ではなく計算なので、構成の本体（comps）は読まない。
 */
export default function LadderPage() {
  const [lang, setLang] = useState<Lang>(readLang)
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  /** 選んだ紋章（emblems の idx）。 */
  const [picked, setPicked] = useState<number[]>([])
  const [allowFive, setAllowFive] = useState(false)
  const [bonus, setBonus] = useState(0)
  const [marks, setMarks] = useState<Map<string, UnitMark>>(() => new Map())
  const [unitsOpen, setUnitsOpen] = useState(false)
  const [steps, setSteps] = useState<WireStep[]>([])
  /** 計算中の依頼で、もう新しい結果に置き換わったレベル。それ以外の行は前の入力の結果なので淡く描く。 */
  const [freshLevels, setFreshLevels] = useState<Set<number>>(() => new Set())
  const [gains, setGains] = useState<Map<number, number>>(() => new Map())
  const [computing, setComputing] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadLadderDictionaries()
      .then((stats) => !cancelled && setLoad({ status: 'ready', stats }))
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

  const stats = load.status === 'ready' ? load.stats : null
  const data = useMemo<LadderData | null>(
    () => (stats ? { units: stats.units, traits: stats.traits, granters: stats.granters } : null),
    [stats],
  )
  const emblemTraits = useMemo(() => (stats ? picked.map((i) => stats.emblems[i].trait) : []), [stats, picked])
  // 印を付けられるのは盤面に置ける駒だけ（チームプランナーに無い変種は出さない）。
  const pickable = useMemo(
    () => (stats ? candidateUnits(stats.units, true).map((i) => stats.units[i]) : []),
    [stats],
  )
  const { locked, excluded } = useMemo(() => {
    const locked: number[] = []
    const excluded: number[] = []
    stats?.units.forEach((u, i) => {
      const m = marks.get(u.api)
      if (m === 'use') locked.push(i)
      else if (m === 'avoid') excluded.push(i)
    })
    return { locked, excluded }
  }, [stats, marks])

  // 探索は Worker で回す。入力が変わるたびに新しい id で依頼し、古い結果は捨てる。
  const workerRef = useRef<Worker | null>(null)
  const reqId = useRef(0)
  useEffect(() => {
    const w = new Worker(new URL('./lib/ladder.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w
    w.onmessage = (e: MessageEvent<LadderResponse>) => {
      const r = e.data
      if (r.id !== reqId.current) return
      if (r.kind === 'step') {
        // 前の入力の結果は消さずに残し、届いたレベルから差し替える（毎回空にすると画面がちらつく）。
        setSteps((s) => [...s.filter((x) => x.level !== r.step.level), r.step].sort((a, b) => a.level - b.level))
        setFreshLevels((f) => new Set(f).add(r.step.level))
      }
      else if (r.kind === 'emblem') setGains((g) => new Map(g).set(r.emblem, r.gain))
      else setComputing(false)
    }
    return () => w.terminate()
  }, [])
  useEffect(() => {
    if (!data || !workerRef.current) return
    const id = ++reqId.current
    setFreshLevels(new Set())
    setGains(new Map())
    setComputing(true)
    const req: LadderRequest = {
      id,
      data,
      levels: LEVELS,
      bonus,
      emblems: emblemTraits,
      allowFive,
      locked,
      excluded,
      judgeLevel: JUDGE_LEVEL,
    }
    workerRef.current.postMessage(req)
  }, [data, emblemTraits, allowFive, bonus, locked, excluded])

  const toggleEmblem = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))
  const cycleUnit = (api: string) =>
    setMarks((m) => {
      const next = new Map(m)
      const mk = nextMark(m.get(api))
      if (mk) next.set(api, mk)
      else next.delete(api)
      return next
    })
  const unmarkUnit = (api: string) =>
    setMarks((m) => {
      const next = new Map(m)
      next.delete(api)
      return next
    })

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5 md:px-5 md:py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-5 w-1 shrink-0 rounded-full bg-gold" aria-hidden />
          <h1 className="truncate text-base font-extrabold tracking-tight text-ink md:text-lg">{t(lang, 'title')}</h1>
        </div>
        <SiteNav current="ladder" lang={lang} />
        <button
          type="button"
          onClick={() => setLang((l) => (l === 'ja' ? 'en' : 'ja'))}
          className="ml-auto flex h-8 items-center justify-center rounded-md border border-line bg-surface-2 px-3 text-xs font-semibold text-ink transition-colors hover:border-line-strong hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
          title={t(lang, 'langSwitchTitle')}
        >
          {lang === 'ja' ? 'EN' : 'JP'}
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4 md:px-5">
        {load.status === 'loading' && <p className="text-sm text-muted">{t(lang, 'loading')}</p>}
        {load.status === 'error' && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>
              {t(lang, 'loadFailed')}: {load.message}
            </span>
            <button
              type="button"
              onClick={() => {
                setLoad({ status: 'loading' })
                setReloadKey((k) => k + 1)
              }}
              className="rounded-md border border-line bg-surface-2 px-3 py-1 text-ink hover:border-line-strong"
            >
              {t(lang, 'retry')}
            </button>
          </div>
        )}

        {stats && data && (
          <>
            <section className="flex flex-col gap-2" aria-label={t(lang, 'ladderEmblems')}>
              <h2 className="text-xs font-semibold text-muted" title={t(lang, 'ladderEmblemsHint')}>
                {t(lang, 'ladderEmblems')}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
                {stats.emblems.map((e, i) => {
                  const on = picked.includes(i)
                  const name = pickName(lang, e)
                  return (
                    <button
                      key={e.api}
                      type="button"
                      aria-pressed={on}
                      aria-label={name}
                      title={name}
                      onClick={() => toggleEmblem(i)}
                      className={`aspect-square overflow-hidden rounded-md border-2 bg-surface-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
                        on ? 'border-gold shadow-[0_0_14px_-4px_var(--color-hand)]' : 'border-line'
                      }`}
                    >
                      <img src={e.icon} alt="" className={`h-full w-full object-cover ${on ? '' : 'opacity-60'}`} />
                    </button>
                  )
                })}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                {t(lang, 'ladderFive')}
                <SegmentedControl
                  ariaLabel={t(lang, 'ladderFive')}
                  value={allowFive ? 'on' : 'off'}
                  onChange={(k) => setAllowFive(k === 'on')}
                  options={[
                    { key: 'off', label: t(lang, 'ladderFiveOff') },
                    { key: 'on', label: t(lang, 'ladderFiveOn') },
                  ]}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                {t(lang, 'ladderBonus')}
                <SegmentedControl
                  ariaLabel={t(lang, 'ladderBonus')}
                  value={bonus ? 'plus' : 'none'}
                  onChange={(k) => setBonus(k === 'plus' ? 1 : 0)}
                  options={[
                    { key: 'none', label: '±0' },
                    { key: 'plus', label: '+1' },
                  ]}
                />
              </label>
              <button
                type="button"
                aria-expanded={unitsOpen}
                onClick={() => setUnitsOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-1 text-sm font-medium text-ink hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
              >
                {t(lang, 'ladderUnits')}
                {marks.size > 0 && <span className="tabular-nums text-gold">{marks.size}</span>}
                <span aria-hidden className={`text-[10px] text-faint transition-transform ${unitsOpen ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>
            </div>

            {unitsOpen && (
              <section
                className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
                style={{ '--tile-size': '40px' } as CSSProperties}
              >
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-[11px] text-faint">{t(lang, 'ladderUnitsHint')}</p>
                  {marks.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setMarks(new Map())}
                      className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-ink"
                    >
                      {t(lang, 'ladderUnitsClear')}
                    </button>
                  )}
                </div>
                <UnitGrid units={pickable} marks={marks} lang={lang} onCycle={cycleUnit} onUnmark={unmarkUnit} />
              </section>
            )}

            {picked.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm xl:flex-row xl:flex-wrap xl:gap-x-6">
                {[...new Set(emblemTraits)].map((tr) => {
                  const gain = gains.get(tr)
                  const e = stats.emblems.find((x) => x.trait === tr)!
                  const name = pickName(lang, e)
                  if (gain === undefined)
                    return (
                      <li key={tr} className="text-faint">
                        {name}: {t(lang, 'ladderComputing')}
                      </li>
                    )
                  return (
                    <li key={tr} className={gain > 0 ? 'text-ink' : 'text-ember-warm'}>
                      {gain > 0 ? t(lang, 'ladderEmblemUse', { name, n: gain }) : t(lang, 'ladderEmblemReroll', { name })}
                    </li>
                  )
                })}
              </ul>
            )}

            <section className="flex flex-col gap-2" aria-label={t(lang, 'ladderRoute')}>
              <h2 className="flex items-center gap-2 text-xs font-semibold text-muted">
                {t(lang, 'ladderRoute')}
                {computing && <span className="font-normal text-faint">{t(lang, 'ladderComputing')}</span>}
              </h2>
              <ol className="flex flex-col gap-2 xl:grid xl:grid-cols-[auto_auto_minmax(0,1fr)_auto] xl:gap-x-5">
                {steps.map((s) => (
                  <RouteRow key={s.level} step={s} stats={stats} lang={lang} stale={computing && !freshLevels.has(s.level)} />
                ))}
              </ol>
            </section>

            <details className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <summary className="cursor-pointer text-xs font-semibold text-muted">{t(lang, 'ladderRewards')}</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {Object.entries(LADDER_REWARDS).map(([n, r]) => (
                  <div key={n} className="contents">
                    <dt className={`tabular-nums ${Number(n) === TEAM_SIZE_STEP ? 'font-bold text-gold' : 'text-muted'}`}>
                      {t(lang, 'ladderTraits', { n })}
                    </dt>
                    <dd className={Number(n) === TEAM_SIZE_STEP ? 'text-ink' : 'text-muted'}>{r[lang]}</dd>
                  </div>
                ))}
              </dl>
            </details>

            <p className="text-[11px] leading-relaxed text-faint">{t(lang, 'ladderNote')}</p>
          </>
        )}
      </main>

      {/* Riot の Legal Jibber Jabber。ポリシー上「プレイヤーが見つけやすい場所」への掲示が必須。 */}
      <footer className="shrink-0 border-t border-line bg-surface px-4 py-1.5 sm:px-5 sm:py-2">
        <p className="text-[10px] leading-tight text-faint sm:text-xs sm:leading-snug">{t(lang, 'legal')}</p>
      </footer>
    </div>
  )
}

/** ルート表の1行: レベル・種類数・盤面（足す駒を金で囲む）・発動特性・プランナーコード。 */
function RouteRow({ step, stats, lang, stale }: { step: WireStep; stats: StatsFile; lang: Lang; stale: boolean }) {
  const [copied, setCopied] = useState(false)
  const { board } = step
  const added = new Set(step.added)
  const choices = new Map(board.choices)
  const { choice } = useMemo(() => splitGranters(stats.granters), [stats])
  // 盤面は 残す駒 → 足す駒 の順、その中は安い順（ゲームで買う順に近い）。同コストは名前順。
  const byCost = (a: number, b: number) =>
    stats.units[a].cost - stats.units[b].cost ||
    pickName(lang, stats.units[a]).localeCompare(pickName(lang, stats.units[b]), lang)
  const removed = [...step.removed].sort(byCost)
  const units = [...board.units].sort(
    (a, b) =>
      Number(added.has(a)) - Number(added.has(b)) ||
      stats.units[a].cost - stats.units[b].cost ||
      pickName(lang, stats.units[a]).localeCompare(pickName(lang, stats.units[b]), lang),
  )
  const traits = board.counts
    .map(([ti, n]) => ({ ti, n, tier: activeTier(n, stats.traits[ti]?.tiers ?? []) }))
    .filter((x) => x.tier)
    .sort((a, b) => (b.tier!.style - a.tier!.style) || b.n - a.n)
  const tierOf = new Map(traits.map((x) => [x.ti, x.tier!.style]))
  /** 駒が持つ特性のうち、この盤面で発動しているもの（選択式で選んだ特性を含む）。 */
  const activeTraitsOf = (u: number, pick: number | undefined) =>
    [...new Set([...stats.units[u].traits, ...(pick !== undefined ? [pick] : [])])]
      .filter((ti) => tierOf.has(ti))
      .sort((a, b) => tierOf.get(b)! - tierOf.get(a)!)
      .map((ti) => ({ icon: stats.traits[ti].icon, name: pickName(lang, stats.traits[ti]), style: tierOf.get(ti)! }))
  const reward = LADDER_REWARDS[board.active]
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildPlannerCode(board.units, stats.units, stats.setNumber))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボードが使えない環境では何もしない。
    }
  }
  return (
    <li
      className={`flex flex-col gap-2 rounded-md border border-line bg-surface p-3 transition-opacity xl:col-span-4 xl:grid xl:grid-cols-subgrid xl:items-center ${stale ? 'opacity-40' : ''}`}
    >
      <div className="flex items-baseline gap-3 xl:contents">
        <div className="flex min-w-0 flex-1 items-baseline gap-3 xl:col-start-1 xl:row-start-1 xl:w-52 xl:flex-none xl:flex-col xl:gap-0.5">
          <span className="flex items-baseline gap-3">
            <span className="text-xs font-semibold text-muted">{t(lang, 'ladderLevel', { n: step.level })}</span>
            <span
              className={`text-lg font-extrabold tabular-nums ${board.active >= TEAM_SIZE_STEP ? 'text-gold' : 'text-ink'}`}
            >
              {t(lang, 'ladderTraits', { n: board.active })}
            </span>
          </span>
          {reward && (
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-faint xl:max-w-full xl:whitespace-normal"
              title={t(lang, 'ladderReward', { n: board.active })}
            >
              {reward[lang]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={copy}
          title={t(lang, 'ladderCopyTitle')}
          className="ml-auto shrink-0 xl:col-start-4 xl:row-start-1 rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
        >
          {copied ? t(lang, 'ladderCopied') : t(lang, 'ladderCopy')}
        </button>
      </div>

      {/*
       * 盤面: 残す駒 → 足す駒（金の枠と＋）→ 外す駒（灰色と−）の順に1列で並べる。
       * 外す駒も同じ大きさで同じ列に置く。小さく脇に添えると、外すのか残すのか読み取れない。
       */}
      <div className="flex flex-wrap items-start gap-1.5 xl:col-start-2 xl:row-start-1">
        {units.map((u) => {
          const unit = stats.units[u]
          const pick = choices.get(u)
          const pickTrait = pick !== undefined && choice.has(u) ? stats.traits[pick] : undefined
          const name = pickName(lang, unit)
          const label = pickTrait
            ? `${name}（${t(lang, 'ladderChoice', { unit: name })}: ${pickName(lang, pickTrait)}）`
            : name
          return (
            <UnitChip
              key={u}
              icon={unit.icon}
              cost={unit.cost}
              label={added.has(u) ? `${t(lang, 'ladderAdd')}: ${label}` : label}
              mark={added.has(u) ? 'add' : undefined}
              traits={activeTraitsOf(u, pickTrait ? pick : undefined)}
            />
          )
        })}
        {removed.map((u) => (
          <UnitChip
            key={`x${u}`}
            icon={stats.units[u].icon}
            cost={stats.units[u].cost}
            label={`${t(lang, 'ladderRemove')}: ${pickName(lang, stats.units[u])}`}
            mark="remove"
            traits={[]}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-1 xl:col-start-3 xl:row-start-1">
        {traits.map(({ ti, n, tier }) => {
          const tr = stats.traits[ti]
          return (
            <span
              key={ti}
              title={pickName(lang, tr)}
              className={`inline-flex h-[22px] items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold tabular-nums ${styleClasses(tier!.style)}`}
            >
              <img src={tr.icon} alt="" className="h-3.5 w-3.5 object-contain" />
              {n}
            </span>
          )
        })}
      </div>
    </li>
  )
}

/**
 * ルート表の駒1体。足す駒は金の＋、外す駒は灰色の顔と−。印は駒の角の外側に置き、顔を隠さない。
 * 駒の下には、その駒が持つ特性のうちこの盤面で発動しているものを段の色で並べる。
 */
function UnitChip({
  icon,
  cost,
  label,
  mark,
  traits,
}: {
  icon: string
  cost: number
  label: string
  mark?: 'add' | 'remove'
  traits: { icon: string; name: string; style: number }[]
}) {
  return (
    <span className="lunit" title={label}>
      <span data-cost={cost} className={`utile ${mark === 'add' ? 'utile--use' : mark === 'remove' ? 'utile--avoid' : ''}`}>
        <img src={icon} alt={label} />
      </span>
      {mark && (
        <span className={`lunit__mark lunit__mark--${mark}`} aria-hidden>
          <svg viewBox="0 0 10 10">{mark === 'add' ? <path d="M5 2v6M2 5h6" /> : <path d="M2 5h6" />}</svg>
        </span>
      )}
      {traits.length > 0 && (
        <span className="lunit__traits">
          {traits.map((tr) => (
            <span key={tr.name} title={tr.name} className={`lunit__trait ${styleClasses(tr.style)}`}>
              <img src={tr.icon} alt={tr.name} />
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
