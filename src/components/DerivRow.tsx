import { useState, type CSSProperties } from 'react'
import type { StatsFile } from '../../shared/types'
import type { Deriv, Lane, LaneUse } from '../lib/backbone'
import { activeTier, buildPlannerCode, holderMap, styleClasses, tierOfEdge } from '../lib/format'
import { pickName, t, type Lang } from '../lib/i18n'
import { LaneUnit } from './LaneUnit'
import { RecipeLabel } from './RecipeLabel'
import { SampleMeter } from './SampleMeter'
import { Tip } from './Tip'

interface DerivRowProps {
  stats: StatsFile
  deriv: Deriv
  /** 系統ぜんぶで共通の列。盤面はこの並びで描く。 */
  lanes: Lane[]
  /** この体数グループから見た各列の状態（`lanes` と同じ並び）。 */
  laneUse: LaneUse[]
  /** 同ユニット数コホートの平均順位。平均順位の**色**の根拠にだけ使う（数値は出さない）。 */
  cohort: Map<number, number>
  /**
   * 系統内で使う紋章が派生ごとに違う場合は true。この行が使う紋章を明示する。
   * 差分（追加・欠落）が同じでも紋章の使い方が違えば別の構成なので、出さないと見分けがつかない。
   */
  showEmblems: boolean
  /** 採用数が薄い行を淡く描く（「少数を薄く」ON のとき）。消さずに弱めるだけ。 */
  dim?: boolean
  lang: Lang
}

/**
 * 背骨からの派生1行。盤面・アイテム・装備者・発動特性を**この行のものとして全部**描く。
 *
 * 差分（＋この駒）だけを描いていた頃は、読み手が毎行コアと差分から盤面を組み直す必要があり、
 * それがゲーム中の瞬間判断をいちばん妨げていた。代わりに列をそろえる: 系統ぜんぶで
 * 1列＝1ユニットに固定するので、共通駒は縦にそろい、目が動くのは「選ぶ枠」の列だけになる。
 * ユニットの名前は列見出し（FamilyCard）が1回出すので、行では出さない。
 *
 * 平均順位の色は**同じ体数のコホートからの差**で切る（`tierOfEdge`）。絶対値だと 10体グループが
 * 全部 S（同じ赤）になり、色が情報を運ばなくなるため。差の数値は画面に出さない。
 */
export function DerivRow({
  stats,
  deriv,
  lanes,
  laneUse,
  cohort,
  showEmblems,
  dim,
  lang,
}: DerivRowProps) {
  const { traits, units, emblems } = stats
  const { comp, row, synergy } = deriv
  const [copied, setCopied] = useState(false)

  const unitCount = comp.units.length
  const avgPlace = row.n > 0 ? row.p / row.n : NaN
  const hasPlace = Number.isFinite(avgPlace)
  const tier = hasPlace
    ? tierOfEdge(avgPlace, unitCount, cohort)
    : { label: '?', color: '#707682', classes: '' }

  const top4Rate = row.n > 0 ? (row.top4 / row.n) * 100 : 0
  const winRate = row.n > 0 ? (row.win / row.n) * 100 : 0

  const holders = holderMap(comp, row.used)
  const code = buildPlannerCode(comp.units, units, stats.setNumber)

  // この盤面の全発動特性。[traitIdx, style, 発動段, この派生で伸びたか]
  // 伸びた特性を先頭に、その後は発動ティアの高い順。
  const gainedSet = new Set(synergy.map(([ti]) => ti))
  const chips: [number, number, number, boolean][] = []
  for (const [ti, count] of deriv.traitCount) {
    const tr = traits[ti]
    if (!tr) continue
    const at = activeTier(count, tr.tiers)
    if (!at) continue
    chips.push([ti, at.style, at.min, gainedSet.has(ti)])
  }
  chips.sort(
    (a, b) =>
      Number(b[3]) - Number(a[3]) ||
      b[1] - a[1] ||
      (traits[a[0]].name < traits[b[0]].name ? -1 : 1),
  )
  const anyGained = chips.some((c) => c[3])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボード不可（権限等）の場合は無視。
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5 transition-all hover:bg-surface-2/40 ${
        dim ? 'opacity-55 hover:opacity-100' : ''
      }`}
    >
      {/* 列そろえの盤面。共通駒は縦にそろい、変わるのは帯を敷いた「選ぶ枠」の列だけ。 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* 1段目: 列そろえの盤面と、この行が活用している紋章 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="lanes" style={{ '--lane-n': lanes.length } as CSSProperties}>
            {lanes.map((lane, i) => (
              <LaneUnit
                key={lane.unitIdx}
                stats={stats}
                lane={lane}
                use={laneUse[i]}
                comp={comp}
                holders={holders}
                lang={lang}
              />
            ))}
          </div>

          {/*
           * この行が実際に活用している紋章。同じ盤面でも「1枚だけ使う」と「2枚とも使う」は
           * 別の構成なので、系統内で使い方が割れているときは出さないと2行が同一に見える。
           */}
          {showEmblems && (
            <span className="ml-1 inline-flex items-center gap-1">
              {row.used.map((ei, i) => {
                const e = emblems[ei]
                if (!e) return null
                return (
                  <Tip key={i} label={<RecipeLabel label={pickName(lang, e)} recipe={e.recipe} />}>
                    <img
                      src={e.icon}
                      alt=""
                      loading="lazy"
                      className="h-[20px] w-[20px] shrink-0 rounded bg-base object-contain ring-1 ring-gold"
                    />
                  </Tip>
                )
              })}
            </span>
          )}
        </div>

        {/*
         * この盤面で発動している特性を**すべて**出す（コアだけの行も空にならない）。
         * そのうえで、この駒を足したことで伸びた特性は明るく・太く出す ＝ この派生を選ぶ理由。
         * 金は紋章の色なので使わない（役割が混ざる）。強調は明度と太さでやる。
         */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {chips.map(([traitIdx, style, count, gained]) => {
              const trait = traits[traitIdx]
              const name = trait ? pickName(lang, trait) : `#${traitIdx}`
              // 伸びた特性が1つも無い行（＝コアのまま）は全部を等しく出す。落とす相手がいないのに
              // 全チップを淡くすると、ただ読みにくいだけになる。
              const dimChip = anyGained && !gained
              return (
                <Tip key={traitIdx} label={gained ? `${name} ${count} — ${t(lang, 'synergyGain')}` : `${name} ${count}`}>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 text-[11px] tabular-nums ${styleClasses(
                      style,
                    )} ${
                      gained
                        ? 'h-[22px] font-bold ring-1 ring-ink/25'
                        : `h-[19px] font-semibold ${dimChip ? 'opacity-55' : ''}`
                    }`}
                  >
                    {trait?.icon && (
                      <img
                        src={trait.icon}
                        alt=""
                        loading="lazy"
                        className={gained ? 'h-4 w-4 object-contain' : 'h-3.5 w-3.5 object-contain'}
                      />
                    )}
                    {count}
                  </span>
                </Tip>
              )
            })}
          </div>
        )}
      </div>

      {/* 平均順位（色 = 同体数コホートからの差） */}
      <span
        className="shrink-0 text-[22px] font-extrabold leading-none tabular-nums"
        style={{ color: tier.color }}
        title={t(lang, 'avgPlace')}
      >
        {hasPlace ? avgPlace.toFixed(2) : '—'}
      </span>

      {/* Top4 / 1位 / 採用 */}
      <div className="w-[86px] shrink-0 text-[11px] leading-tight">
        <div className="text-faint">
          {t(lang, 'metricTop4')} <b className="text-ink tabular-nums">{top4Rate.toFixed(1)}%</b>
        </div>
        <div className="text-faint">
          {t(lang, 'metricWin')} <b className="text-ink tabular-nums">{winRate.toFixed(1)}%</b>
        </div>
        {/* 採用数は数字＋4段階の目盛り。下限フィルタで消す代わりに常に見せる。 */}
        <div className="flex items-center gap-1 text-faint">
          {t(lang, 'metricSample')} <SampleMeter n={row.n} lang={lang} />
        </div>
      </div>

      <button
        type="button"
        onClick={copy}
        title={t(lang, 'copyCodeTitle')}
        aria-label={t(lang, 'copyCode')}
        className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
          copied ? 'bg-[#6fc06a] text-[#0f1a10]' : 'bg-ink text-base hover:bg-white'
        }`}
      >
        {copied ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  )
}
