import { useState } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import type { CompUsage } from '../lib/multiset'
import { activeTier, buildPlannerCode, costBorder, starColor, styleClasses, tierOf } from '../lib/format'
import { pickName, t, type Lang } from '../lib/i18n'
import { Tip } from './Tip'

export type SortKey = 'place' | 'top4' | 'win' | 'adopt'

interface CompCardProps {
  stats: StatsFile
  comp: CompStats
  usage: CompUsage
  /** 選択中の紋章インデックス（重複除去済み）。 */
  selList: number[]
  sortKey: SortKey
  lang: Lang
}

/** 構成一覧の1カード。 */
export function CompCard({ stats, comp, usage, selList, sortKey, lang }: CompCardProps) {
  const { traits, units, emblems, items } = stats
  const [copied, setCopied] = useState(false)
  const selectedEmblemSet = new Set(selList)

  const avgPlace = usage.adopt > 0 ? usage.p / usage.adopt : NaN
  const hasPlace = Number.isFinite(avgPlace)
  const tier = hasPlace ? tierOf(avgPlace) : { label: '?', classes: 'bg-slate-700 text-slate-300' }
  const code = buildPlannerCode(comp.units, units, stats.setNumber)

  const tierAura =
    tier.label === 'S'
      ? 'border-amber-400/50 shadow-[0_0_20px_rgba(251,191,36,0.15)] bg-gradient-to-r from-amber-400/10 to-slate-900/40 hover:border-amber-400/80 hover:shadow-[0_0_25px_rgba(251,191,36,0.25)]'
      : tier.label === 'A'
        ? 'border-fuchsia-500/40 shadow-[0_0_15px_rgba(217,70,239,0.1)] bg-gradient-to-r from-fuchsia-500/10 to-slate-900/40 hover:border-fuchsia-500/60 hover:shadow-[0_0_20px_rgba(217,70,239,0.2)]'
        : 'border-slate-800 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-800/80 hover:shadow-lg'

  // 発動特性 = 盤面ユニットの所持トレイト ＋ 選択紋章のうち活用された付与分（決定的算出）。
  const traitCount = new Map<number, number>()
  for (const ui of comp.units) {
    for (const ti of units[ui]?.traits ?? []) traitCount.set(ti, (traitCount.get(ti) ?? 0) + 1)
  }
  for (const ei of usage.req.keys()) {
    const add = Math.ceil(usage.best.get(ei) ?? 0) // 活用された個数
    if (add <= 0) continue
    const ti = emblems[ei]?.trait
    if (ti == null) continue
    traitCount.set(ti, (traitCount.get(ti) ?? 0) + add)
  }
  // 活性トレイトのみ（発動数 >= 最小ブレークポイント）。[traitIdx, style, 発動段]
  const traitChips: [number, number, number][] = []
  for (const [ti, count] of traitCount) {
    const tr = traits[ti]
    if (!tr) continue
    const at = activeTier(count, tr.tiers)
    if (!at) continue
    traitChips.push([ti, at.style, at.min])
  }
  traitChips.sort((a, b) => b[1] - a[1] || (traits[a[0]].name < traits[b[0]].name ? -1 : 1))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボード不可（権限等）の場合は無視。
    }
  }

  const metricCell = (active: boolean, label: string, value: string) => (
    <div
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 transition-colors ${
        active ? 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40 font-medium' : 'bg-slate-800/40 text-slate-400'
      }`}
    >
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className="text-xs font-bold tabular-nums text-slate-100">{value}</span>
    </div>
  )

  return (
    <div className={`group flex items-stretch gap-4 rounded-xl border p-3.5 transition-all duration-300 hover:-translate-y-0.5 ${tierAura}`}>
      {/* ティアバッジ */}
      <div
        className={`flex w-12 shrink-0 items-center justify-center rounded-lg text-2xl font-black shadow-lg ${tier.classes}`}
        title={hasPlace ? t(lang, 'tierTitle', { x: avgPlace.toFixed(2) }) : t(lang, 'tierNoData')}
      >
        {tier.label}
      </div>

      {/* 構成本体 */}
      <div className="min-w-0 flex-1">
        {/* 発動中の特性（アイコン＋発動数で統一。紋章付与分も特別なマークなし） */}
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {traitChips.map(([traitIdx, style, count]) => {
            const trait = traits[traitIdx]
            return (
              <Tip key={traitIdx} label={trait ? pickName(lang, trait) : `#${traitIdx}`}>
                <span
                  className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${styleClasses(
                    style,
                  )}`}
                >
                  {trait?.icon && (
                    <img src={trait.icon} alt="" loading="lazy" className="h-5 w-5 object-contain drop-shadow" />
                  )}
                  {count ? (
                    <span className="rounded bg-slate-950/60 px-1 text-xs font-bold tabular-nums shadow-inner">
                      {count}
                    </span>
                  ) : null}
                </span>
              </Tip>
            )
          })}
        </div>

        {/* ユニット */}
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {comp.units.map((unitIdx, pos) => {
            const unit = units[unitIdx]
            if (!unit) return null
            const unitName = pickName(lang, unit)
            const star = comp.unitStars?.[pos] ?? 0
            const unitItemIdxs = comp.unitItems.filter((ui) => ui[0] === unitIdx).map((ui) => ui[1])
            const unitEmblemIdxs = comp.holders
              .filter((h) => h[1] === unitIdx)
              .map((h) => h[0])
              .filter((ei) => selectedEmblemSet.has(ei))
            const hasUnder = unitItemIdxs.length > 0 || unitEmblemIdxs.length > 0
            return (
              <div key={unitIdx} className="flex w-14 flex-col items-center gap-0.5">
                <div className={`h-3 text-[11px] leading-3 ${starColor(star)}`}>
                  {star > 0 ? '★'.repeat(star) : ''}
                </div>
                <Tip label={star > 0 ? `${unitName} ★${star}` : unitName}>
                  <img
                    src={unit.icon}
                    alt={unitName}
                    loading="lazy"
                    className={`h-14 w-14 rounded-md border-2 object-cover transition-transform duration-150 group-hover:scale-[1.03] ${costBorder(
                      unit.cost,
                    )}`}
                  />
                </Tip>
                {hasUnder && (
                  <div className="flex flex-col items-center gap-0.5">
                    {unitItemIdxs.length > 0 && (
                      <div className="grid grid-cols-3 justify-items-center gap-0.5">
                        {unitItemIdxs.map((ii, idx) => {
                          const item = items?.[ii]
                          if (!item) return null
                          return (
                            <Tip key={`i${ii}-${idx}`} label={pickName(lang, item)}>
                              <img
                                src={item.icon}
                                alt={pickName(lang, item)}
                                loading="lazy"
                                className="h-5 w-5 rounded object-cover"
                              />
                            </Tip>
                          )
                        })}
                      </div>
                    )}
                    {unitEmblemIdxs.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-0.5">
                        {unitEmblemIdxs.map((ei) => {
                          const emblem = emblems[ei]
                          if (!emblem) return null
                          const half = (usage.best.get(ei) ?? 0) < (usage.req.get(ei) ?? 1)
                          return (
                            <Tip key={`e${ei}`} label={pickName(lang, emblem)}>
                              <img
                                src={emblem.icon}
                                alt={pickName(lang, emblem)}
                                loading="lazy"
                                className={`h-5 w-5 rounded object-contain ring-1 ${
                                  half ? 'opacity-60 ring-amber-400/40' : 'ring-amber-400'
                                }`}
                              />
                            </Tip>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 指標ブロック */}
      <div className="flex w-36 shrink-0 flex-col justify-center gap-1">
        <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t(lang, 'avg')}</span>
          <span
            className={`text-[28px] leading-none font-black tabular-nums drop-shadow-sm ${
              sortKey === 'place' ? 'text-amber-400' : 'text-slate-100'
            }`}
          >
            {hasPlace ? avgPlace.toFixed(2) : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {metricCell(sortKey === 'adopt', t(lang, 'metricRate'), `${usage.adopt}`)}
          {metricCell(sortKey === 'top4', t(lang, 'metricTop4'), `${usage.top4}/${usage.adopt}`)}
          {metricCell(sortKey === 'win', t(lang, 'metricWin'), `${usage.win}/${usage.adopt}`)}
        </div>
        <button
          type="button"
          onClick={copy}
          className="mt-1 rounded-md border border-slate-700 bg-slate-800/50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          title={t(lang, 'copyCodeTitle')}
        >
          {copied ? `✓ ${t(lang, 'copied')}` : t(lang, 'copyCode')}
        </button>
      </div>
    </div>
  )
}
