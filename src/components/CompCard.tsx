import { useState } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import { emblemGames } from '../lib/multiset'
import { buildPlannerCode, costBorder, starColor, styleClasses, tierOf } from '../lib/format'
import { pickName, t, type Lang } from '../lib/i18n'
import { Tip } from './Tip'

export type SortKey = 'rate' | 'place' | 'top4' | 'win'

interface CompCardProps {
  stats: StatsFile
  comp: CompStats
  /** 同時装着ベースで集計した成績（活用ゲームのみ）。 */
  agg: { n: number; top4: number; win: number; p: number }
  avgPlace: number
  /** 選択紋章のうち同時装着できた最大数。 */
  usedCount: number
  /** 選択紋章の種類数（バッジ分母）。 */
  k: number
  /** 選択中の紋章インデックス（重複除去済み）。 */
  selList: number[]
  sortKey: SortKey
  lang: Lang
}

/** 構成一覧の1カード。ティア・構成名・発動特性・ユニット・指標を表示する。 */
export function CompCard({ stats, comp, agg, avgPlace, usedCount, k, selList, sortKey, lang }: CompCardProps) {
  const { traits, units, emblems, items } = stats
  const [copied, setCopied] = useState(false)
  const selectedEmblemSet = new Set(selList)

  const hasPlace = Number.isFinite(avgPlace)
  const tier = hasPlace ? tierOf(avgPlace) : { label: '?', classes: 'bg-zinc-700 text-zinc-300' }
  const compName = (lang === 'ja' ? comp.labelJa : comp.label) || comp.label
  const code = buildPlannerCode(comp.units, units, stats.setNumber)
  const synergies = comp.synergies ?? comp.traits

  // 装備紋章が付与するトレイトのうち、構成の synergies に未掲載のものを「紋章由来」として補完。
  // （付与トレイトは紋章装備サブセットでのみ発動し、クラスタ過半数に届かず希釈されるため）
  const baseSynTraitIdxs = new Set(synergies.map((s) => s[0]))
  const grantedChips: { traitIdx: number; emblemIdx: number }[] = []
  for (const ei of selList) {
    if (emblemGames(comp, ei) <= 0) continue
    const gt = emblems[ei]?.trait
    if (gt == null || baseSynTraitIdxs.has(gt)) continue
    if (grantedChips.some((g) => g.traitIdx === gt)) continue
    grantedChips.push({ traitIdx: gt, emblemIdx: ei })
  }

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
      className={`flex items-baseline justify-between gap-2 rounded-md px-1.5 py-0.5 transition-colors ${
        active ? 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30' : 'text-zinc-400'
      }`}
    >
      <span className="text-[11px]">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-zinc-100">{value}</span>
    </div>
  )

  return (
    <div className="group flex items-stretch gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 transition-all duration-150 hover:border-zinc-700 hover:bg-zinc-900/80 hover:shadow-lg hover:shadow-black/30">
      {/* ティアバッジ */}
      <div
        className={`flex w-12 shrink-0 items-center justify-center rounded-lg text-2xl font-black shadow-inner ${tier.classes}`}
        title={hasPlace ? t(lang, 'tierTitle', { x: avgPlace.toFixed(2) }) : t(lang, 'tierNoData')}
      >
        {tier.label}
      </div>

      {/* 構成本体 */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 truncate text-base font-semibold text-zinc-100">{compName}</span>
          {k >= 2 && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                usedCount >= k ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-700/70 text-amber-200'
              }`}
              title={t(lang, 'utilizationTitle')}
            >
              {t(lang, 'utilization', { n: usedCount, k })}
            </span>
          )}
          <span className="shrink-0 rounded-full bg-zinc-700/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">
            {t(lang, 'activeTraits', { n: synergies.length })}
          </span>
        </div>

        {/* 発動中の特性のみの行 */}
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {synergies.map(([traitIdx, style, count]) => {
            const trait = traits[traitIdx]
            return (
              <Tip key={traitIdx} label={trait ? pickName(lang, trait) : `#${traitIdx}`}>
                <span
                  className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${styleClasses(
                    style,
                  )}`}
                >
                  {trait?.icon && (
                    <img src={trait.icon} alt="" loading="lazy" className="h-5 w-5 object-contain" />
                  )}
                  {count ? (
                    <span className="rounded bg-zinc-950/40 px-1 text-xs font-bold tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </span>
              </Tip>
            )
          })}
          {grantedChips.map(({ traitIdx, emblemIdx }) => {
            const trait = traits[traitIdx]
            const emblem = emblems[emblemIdx]
            return (
              <Tip
                key={`g${traitIdx}`}
                label={`${trait ? pickName(lang, trait) : `#${traitIdx}`}（${emblem ? pickName(lang, emblem) : ''}）`}
              >
                <span className="relative inline-flex items-center rounded-md border border-amber-400/70 bg-amber-400/10 px-1.5 py-0.5 text-xs font-semibold text-amber-200">
                  {trait?.icon && (
                    <img src={trait.icon} alt="" loading="lazy" className="h-5 w-5 object-contain" />
                  )}
                  {emblem?.icon && (
                    <img
                      src={emblem.icon}
                      alt=""
                      loading="lazy"
                      className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-zinc-900 object-contain ring-1 ring-amber-400"
                    />
                  )}
                </span>
              </Tip>
            )
          })}
        </div>

        {/* ユニット（下に推奨アイテム・装備紋章） */}
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {comp.units.map((unitIdx, pos) => {
            const unit = units[unitIdx]
            if (!unit) return null
            const unitName = pickName(lang, unit)
            const star = comp.unitStars?.[pos] ?? 0
            const unitItemIdxs = comp.unitItems.filter((ui) => ui[0] === unitIdx).map((ui) => ui[1])
            // 装備紋章は「選択中の紋章」のみ表示（ユーザー指定）。
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
                          return (
                            <Tip key={`e${ei}`} label={pickName(lang, emblem)}>
                              <img
                                src={emblem.icon}
                                alt={pickName(lang, emblem)}
                                loading="lazy"
                                className="h-5 w-5 rounded object-contain ring-1 ring-amber-400"
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
      <div className="flex w-36 shrink-0 flex-col justify-center gap-0.5">
        <div className="mb-0.5 flex items-baseline justify-between gap-2 px-1.5">
          <span className="text-[11px] text-zinc-400">{t(lang, 'avg')}</span>
          <span
            className={`text-2xl font-bold tabular-nums ${
              sortKey === 'place' ? 'text-amber-300' : 'text-zinc-100'
            }`}
          >
            {hasPlace ? avgPlace.toFixed(2) : '—'}
          </span>
        </div>
        {metricCell(sortKey === 'rate', t(lang, 'metricRate'), `${agg.n}/${comp.n}`)}
        {metricCell(sortKey === 'top4', t(lang, 'metricTop4'), `${agg.top4}/${agg.n}`)}
        {metricCell(sortKey === 'win', t(lang, 'metricWin'), `${agg.win}/${agg.n}`)}
        <button
          type="button"
          onClick={copy}
          className="mt-0.5 rounded-md border border-zinc-700 px-1.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          title={t(lang, 'copyCodeTitle')}
        >
          {copied ? `✓ ${t(lang, 'copied')}` : t(lang, 'copyCode')}
        </button>
      </div>
    </div>
  )
}
