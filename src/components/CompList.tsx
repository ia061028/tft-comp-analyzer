import { useState } from 'react'
import type { CompStats, StatsFile, UnitInfo } from '../../shared/types'
import { aggregateComp } from '../lib/multiset'
import { pickName, type Lang } from '../lib/i18n'

type SortKey = 'place' | 'top4' | 'win' | 'pick'

interface CompListProps {
  stats: StatsFile
  /** 表示する構成（全体 or レベル別。App で選択済み） */
  comps: CompStats[]
  sel: number[]
  sortKey: SortKey
  minSample: number
  lang: Lang
}

/** style 値 → バッジ配色（3=ゴールド系, 4=プリズム系, 1-2は念のため銅/銀） */
function styleClasses(style: number): string {
  switch (style) {
    case 4:
      return 'border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-200'
    case 3:
      return 'border-amber-400/60 bg-amber-400/10 text-amber-200'
    case 2:
      return 'border-zinc-300/50 bg-zinc-300/10 text-zinc-100'
    default:
      return 'border-orange-700/60 bg-orange-700/10 text-orange-300'
  }
}

/** スターレベル → ★の配色（3=金,2=銀,1=銅） */
function starColor(star: number): string {
  switch (star) {
    case 3:
      return 'text-amber-300'
    case 2:
      return 'text-zinc-200'
    default:
      return 'text-orange-400'
  }
}

/** コスト → ユニットアイコン枠の配色（1=グレー,2=緑,3=青,4=紫,5=金） */
function costBorder(cost: number): string {
  switch (cost) {
    case 5:
      return 'border-amber-400'
    case 4:
      return 'border-purple-400'
    case 3:
      return 'border-sky-400'
    case 2:
      return 'border-green-400'
    default:
      return 'border-zinc-500'
  }
}

/**
 * 平均順位 → ティア。しきい値は現行データの分布（中央値≈4.3, p10≈3.3, p90≈5.7）に
 * 合わせて各ティアが偏らないよう設定（後で調整可）。
 */
function tierOf(avgPlace: number): { label: string; classes: string } {
  if (avgPlace <= 3.5) return { label: 'S', classes: 'bg-amber-400 text-zinc-950' }
  if (avgPlace <= 4.0) return { label: 'A', classes: 'bg-fuchsia-400 text-zinc-950' }
  if (avgPlace <= 4.5) return { label: 'B', classes: 'bg-sky-400 text-zinc-950' }
  if (avgPlace <= 5.2) return { label: 'C', classes: 'bg-green-400 text-zinc-950' }
  return { label: 'D', classes: 'bg-zinc-600 text-zinc-100' }
}

function pct(num: number, den: number): string {
  if (den === 0) return '0.0%'
  return `${((num / den) * 100).toFixed(1)}%`
}

/** チームプランナーの貼付コード: 01 + 各チャンピオン1バイト(hex) + 10枠まで00 + TFTSet{N}。 */
function buildPlannerCode(unitIdxs: number[], units: UnitInfo[], setNumber: number): string {
  const slots: string[] = []
  for (const idx of unitIdxs) {
    const code = units[idx]?.code ?? 0
    if (code > 0) slots.push(code.toString(16).padStart(2, '0'))
  }
  while (slots.length < 10) slots.push('00')
  return '01' + slots.slice(0, 10).join('') + 'TFTSet' + setNumber
}

export function CompList({ stats, comps, sel, sortKey, minSample, lang }: CompListProps) {
  const { traits, units, emblems, items, totals } = stats
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // 選択中の紋章。装備者ハイライトに使う。
  const selectedEmblemSet = new Set(sel)

  // 紋章未選択時は一覧を出さず案内のみ。
  if (sel.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-12 text-center text-sm text-zinc-400">
        左の紋章を選択すると、その紋章を使う構成が表示されます
      </div>
    )
  }

  const rows = comps
    .map((comp) => {
      const agg = aggregateComp(comp, sel)
      // p が無い（古い stats.json）場合 agg.p は NaN になりうるため有限性を判定。
      const avgPlace = agg.n > 0 && Number.isFinite(agg.p) ? agg.p / agg.n : NaN
      const pickRate = totals.participants > 0 ? agg.n / totals.participants : 0
      return { comp, agg, avgPlace, pickRate }
    })
    .filter(({ agg }) => agg.n > 0 && agg.n >= minSample)
    .sort((a, b) => {
      switch (sortKey) {
        case 'place': {
          // 昇順（小さいほど良い）。平均順位不明（NaN）は末尾へ。
          const av = Number.isFinite(a.avgPlace) ? a.avgPlace : Infinity
          const bv = Number.isFinite(b.avgPlace) ? b.avgPlace : Infinity
          return av - bv
        }
        case 'win':
          return b.agg.win / b.agg.n - a.agg.win / a.agg.n
        case 'pick':
          return b.pickRate - a.pickRate
        case 'top4':
        default:
          return b.agg.top4 / b.agg.n - a.agg.top4 / a.agg.n
      }
    })

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-400">
        条件に一致する構成がありません（頻度 {minSample} 以上）
      </div>
    )
  }

  const copy = async (key: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch {
      // クリップボード不可（権限等）の場合は無視。
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map(({ comp, agg, avgPlace, pickRate }) => {
        const key = comp.label + '|' + comp.traits.map((t) => t[0]).join(',')
        const hasPlace = Number.isFinite(avgPlace)
        const tier = hasPlace
          ? tierOf(avgPlace)
          : { label: '?', classes: 'bg-zinc-700 text-zinc-300' }
        const compName = (lang === 'ja' ? comp.labelJa : comp.label) || comp.label
        const code = buildPlannerCode(comp.units, units, stats.setNumber)
        const metricCell = (active: boolean, label: string, value: string) => (
          <div
            className={`flex items-baseline justify-between gap-2 rounded px-1.5 py-0.5 ${
              active ? 'bg-amber-400/10 text-amber-200' : 'text-zinc-400'
            }`}
          >
            <span className="text-[11px]">{label}</span>
            <span className="text-xs font-semibold tabular-nums text-zinc-100">{value}</span>
          </div>
        )
        return (
          <div
            key={key}
            className="flex items-stretch gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
          >
            {/* ティアバッジ */}
            <div
              className={`flex w-12 shrink-0 items-center justify-center rounded-md text-2xl font-black ${tier.classes}`}
              title={hasPlace ? `平均順位 ${avgPlace.toFixed(2)}` : '平均順位データなし'}
            >
              {tier.label}
            </div>

            {/* 構成本体 */}
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 truncate text-base font-semibold text-zinc-100">
                  {compName}
                </span>
                {(comp.synergies ?? comp.traits).map(([traitIdx, style]) => {
                  const trait = traits[traitIdx]
                  return (
                    <span
                      key={traitIdx}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${styleClasses(
                        style,
                      )}`}
                    >
                      {trait?.icon && (
                        <img
                          src={trait.icon}
                          alt=""
                          loading="lazy"
                          className="h-5 w-5 object-contain"
                        />
                      )}
                      {trait ? pickName(lang, trait) : `#${traitIdx}`}
                    </span>
                  )
                })}
              </div>

              {/* ユニット（下に推奨アイテム・装備紋章） */}
              <div className="flex flex-wrap gap-2">
                {comp.units.map((unitIdx, pos) => {
                  const unit = units[unitIdx]
                  if (!unit) return null
                  const unitName = pickName(lang, unit)
                  const star = comp.unitStars?.[pos] ?? 0
                  const unitItemIdxs = comp.unitItems
                    .filter((ui) => ui[0] === unitIdx)
                    .map((ui) => ui[1])
                  const unitEmblemIdxs = comp.holders
                    .filter((h) => h[1] === unitIdx)
                    .map((h) => h[0])
                  const hasUnder = unitItemIdxs.length > 0 || unitEmblemIdxs.length > 0
                  return (
                    <div key={unitIdx} className="flex w-14 flex-col items-center gap-0.5">
                      <div className={`h-3 text-[11px] leading-3 ${starColor(star)}`}>
                        {star > 0 ? '★'.repeat(star) : ''}
                      </div>
                      <img
                        src={unit.icon}
                        alt={unitName}
                        title={star > 0 ? `${unitName} ★${star}` : unitName}
                        loading="lazy"
                        className={`h-14 w-14 rounded border-2 object-cover ${
                          star === 3 ? 'border-amber-300 ring-1 ring-amber-300/60' : costBorder(unit.cost)
                        }`}
                      />
                      {hasUnder && (
                        <div className="flex flex-wrap justify-center gap-0.5">
                          {unitEmblemIdxs.map((ei) => {
                            const emblem = emblems[ei]
                            if (!emblem) return null
                            return (
                              <img
                                key={`e${ei}`}
                                src={emblem.icon}
                                alt={pickName(lang, emblem)}
                                title={pickName(lang, emblem)}
                                loading="lazy"
                                className={`h-5 w-5 object-contain ${
                                  selectedEmblemSet.has(ei) ? 'rounded ring-1 ring-amber-400' : ''
                                }`}
                              />
                            )
                          })}
                          {unitItemIdxs.map((ii, k) => {
                            const item = items?.[ii]
                            if (!item) return null
                            return (
                              <img
                                key={`i${ii}-${k}`}
                                src={item.icon}
                                alt={pickName(lang, item)}
                                title={pickName(lang, item)}
                                loading="lazy"
                                className="h-5 w-5 rounded object-cover"
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 指標ブロック */}
            <div className="flex w-36 shrink-0 flex-col justify-center gap-0.5">
              <div className="mb-0.5 flex items-baseline justify-between gap-2 px-1.5">
                <span className="text-[11px] text-zinc-400">平均</span>
                <span
                  className={`text-2xl font-bold tabular-nums ${
                    sortKey === 'place' ? 'text-amber-300' : 'text-zinc-100'
                  }`}
                >
                  {hasPlace ? avgPlace.toFixed(2) : '—'}
                </span>
              </div>
              {metricCell(sortKey === 'top4', 'Top4', pct(agg.top4, agg.n))}
              {metricCell(sortKey === 'win', '1位', pct(agg.win, agg.n))}
              {metricCell(sortKey === 'pick', 'Pick', `${(pickRate * 100).toFixed(2)}%`)}
              <div className="px-1.5 text-right text-[11px] text-zinc-500">n={agg.n}</div>
              <button
                type="button"
                onClick={() => copy(key, code)}
                className="mt-0.5 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                title="チームプランナーに貼り付けるコードをコピー"
              >
                {copiedKey === key ? 'コピーしました' : '構成コードをコピー'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
