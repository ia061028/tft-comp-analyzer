import type { StatsFile } from '../../shared/types'
import { aggregateComp } from '../lib/multiset'

type Metric = 'top4' | 'win'

interface CompListProps {
  stats: StatsFile
  sel: number[]
  metric: Metric
  minSample: number
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

function pct(num: number, den: number): string {
  if (den === 0) return '0.0%'
  return `${((num / den) * 100).toFixed(1)}%`
}

export function CompList({ stats, sel, metric, minSample }: CompListProps) {
  const { comps, traits, units } = stats

  const rows = comps
    .map((comp) => ({ comp, agg: aggregateComp(comp, sel) }))
    .filter(({ agg }) => agg.n > 0 && agg.n >= minSample)
    .sort((a, b) => {
      const av = a.agg[metric] / a.agg.n
      const bv = b.agg[metric] / b.agg.n
      return bv - av
    })

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-400">
        条件に一致する構成がありません（サンプル数 {minSample} 以上）
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ comp, agg }, rank) => {
        const primary = pct(agg[metric], agg.n)
        const secondaryMetric: Metric = metric === 'top4' ? 'win' : 'top4'
        const secondary = pct(agg[secondaryMetric], agg.n)
        const secondaryLabel = secondaryMetric === 'top4' ? 'Top4' : '1位'
        return (
          <div
            key={comp.label + '|' + comp.traits.map((t) => t[0]).join(',')}
            className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
          >
            <div className="w-8 shrink-0 text-center text-lg font-bold text-zinc-500">
              {rank + 1}
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1">
                {comp.traits.map(([traitIdx, style]) => {
                  const trait = traits[traitIdx]
                  return (
                    <span
                      key={traitIdx}
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-semibold ${styleClasses(
                        style,
                      )}`}
                    >
                      {trait?.icon && (
                        <img
                          src={trait.icon}
                          alt=""
                          loading="lazy"
                          className="h-4 w-4 object-contain"
                        />
                      )}
                      {trait?.name ?? `#${traitIdx}`}
                    </span>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-1">
                {comp.units.map((unitIdx) => {
                  const unit = units[unitIdx]
                  if (!unit) return null
                  return (
                    <img
                      key={unitIdx}
                      src={unit.icon}
                      alt={unit.name}
                      title={unit.name}
                      loading="lazy"
                      className={`h-11 w-11 rounded border-2 object-cover ${costBorder(
                        unit.cost,
                      )}`}
                    />
                  )
                })}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-2xl font-bold text-zinc-100">{primary}</div>
              <div className="text-xs text-zinc-400">
                {secondaryLabel} {secondary}
              </div>
              <div className="text-xs text-zinc-500">n={agg.n}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
