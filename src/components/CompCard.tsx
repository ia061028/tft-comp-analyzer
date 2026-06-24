import { useState } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import type { CompUsage } from '../lib/multiset'
import {
  activeTier,
  activeTraitCounts,
  bronzeTraitCount,
  buildPlannerCode,
  costBorder,
  starColor,
  styleClasses,
  tierOf,
} from '../lib/format'
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
  /** 生涯ブロンズモード時、ブロンズ特性数バッジを表示。 */
  bronzeMode?: boolean
}

/** 構成一覧の1カード。MetaTFTライクなUI */
export function CompCard({ stats, comp, usage, selList, sortKey, lang, bronzeMode }: CompCardProps) {
  const { traits, units, emblems, items } = stats
  const [copied, setCopied] = useState(false)
  const selectedEmblemSet = new Set(selList)

  const avgPlace = usage.adopt > 0 ? usage.p / usage.adopt : NaN
  const hasPlace = Number.isFinite(avgPlace)
  const tier = hasPlace
    ? tierOf(avgPlace)
    : { label: '?', color: '#707682', classes: 'bg-line-strong text-muted' }
  const code = buildPlannerCode(comp.units, units, stats.setNumber)

  // 発動特性 = 盤面ユニットの所持トレイト ＋ 選択紋章のうち活用された付与分（決定的算出）。
  const traitCount = activeTraitCounts(comp, usage, units, emblems)
  const bronzeCount = bronzeMode ? bronzeTraitCount(traitCount, traits) : 0
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

  const winRate = usage.adopt > 0 ? (usage.win / usage.adopt) * 100 : 0
  const top4Rate = usage.adopt > 0 ? (usage.top4 / usage.adopt) * 100 : 0

  // 副指標セル（現在のソート対象を金でハイライト）。
  const statCell = (active: boolean, label: string, value: string) => (
    <div
      className={`flex min-w-[50px] flex-col items-center rounded-md px-2 py-1 transition-colors ${
        active ? 'bg-gold/10' : ''
      }`}
    >
      <span className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${active ? 'text-gold' : 'text-ink'}`}>{value}</span>
    </div>
  )

  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface transition-all duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-lg hover:shadow-black/30">
      <div
        className="flex min-h-[96px] flex-col items-stretch overflow-hidden rounded-xl sm:flex-row"
        style={{ borderLeft: `3px solid ${tier.color}` }}
      >
        {/* 中央：特性とチャンピオン */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 px-3.5 py-3">
          {/* 特性バッジ */}
          <div className="flex flex-wrap items-center gap-1.5">
            {bronzeMode && (
              <span className="inline-flex h-[19px] items-center rounded-md border border-bronze/50 bg-bronze/15 px-1.5 text-[11px] font-bold text-[#e3b6a6] tabular-nums">
                {t(lang, 'bronzeBadge', { n: bronzeCount })}
              </span>
            )}
            {traitChips.map(([traitIdx, style, count]) => {
              const trait = traits[traitIdx]
              return (
                <Tip key={traitIdx} label={trait ? pickName(lang, trait) : `#${traitIdx}`}>
                  <span
                    className={`inline-flex h-[19px] items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold tabular-nums ${styleClasses(
                      style,
                    )}`}
                  >
                    {trait?.icon && (
                      <img src={trait.icon} alt="" loading="lazy" className="h-3.5 w-3.5 object-contain" />
                    )}
                    {count ? <span>{count}</span> : null}
                  </span>
                </Tip>
              )
            })}
          </div>

          {/* チャンピオン */}
          <div className="flex flex-wrap gap-x-3 gap-y-4">
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
              
              const normalItems = unitItemIdxs.map(ii => {
                const item = items?.[ii]
                return { icon: item?.icon, label: item ? pickName(lang, item) : '', recipe: item?.recipe }
              })
              const emblemItems = unitEmblemIdxs.map(ei => {
                const emblem = emblems[ei]
                return { icon: emblem?.icon, label: emblem ? pickName(lang, emblem) : '', recipe: emblem?.recipe }
              })

              return (
                <div key={unitIdx} className="flex flex-col items-center w-[48px]">
                  {/* スター（画像の上に配置、11px） */}
                  <div className={`h-2.5 text-[11px] leading-none mb-0.5 ${starColor(star)} tracking-[1px]`}>
                    {star > 0 ? '★'.repeat(star) : ''}
                  </div>
                  
                  {/* チャンピオンアイコン（48x48, 角丸3px） */}
                  <Tip label={star > 0 ? `${unitName} ★${star}` : unitName}>
                    <img
                      src={unit.icon}
                      alt={unitName}
                      loading="lazy"
                      className={`h-[48px] w-[48px] shrink-0 rounded-md border-2 object-cover ${costBorder(unit.cost)}`}
                    />
                  </Tip>

                  {/* 通常アイテム（チャンピオン画像の下部にめり込む、最大3つ） */}
                  {normalItems.length > 0 && (
                    <div className="flex justify-center -mt-[14px] z-10 w-[48px] px-0.5 gap-[1px]">
                      {normalItems.slice(0, 3).map((eq, idx) => eq.icon ? (
                        <Tip key={`item-${idx}`} label={
                          eq.recipe ? (
                            <div className="flex flex-col items-center gap-1 px-1 py-0.5">
                              <span className="font-bold text-[11px]">{eq.label}</span>
                              <div className="flex items-center gap-1.5">
                                <img src={eq.recipe[0]} alt="" className="h-[18px] w-[18px] rounded border border-base" />
                                <span className="text-faint text-xs leading-none">+</span>
                                <img src={eq.recipe[1]} alt="" className="h-[18px] w-[18px] rounded border border-base" />
                              </div>
                            </div>
                          ) : eq.label
                        }>
                          <img
                            src={eq.icon}
                            alt=""
                            loading="lazy"
                            className="h-[17px] w-[17px] shrink-0 rounded border border-base bg-base object-cover"
                          />
                        </Tip>
                      ) : null)}
                    </div>
                  )}

                  {/* 紋章アイテム（一段下げる） */}
                  {emblemItems.length > 0 && (
                    <div className={`flex justify-center z-10 w-[48px] px-0.5 gap-[1px] ${normalItems.length > 0 ? 'mt-[2px]' : '-mt-[14px]'}`}>
                      {emblemItems.map((eq, idx) => eq.icon ? (
                        <Tip key={`emblem-${idx}`} label={
                          eq.recipe ? (
                            <div className="flex flex-col items-center gap-1 px-1 py-0.5">
                              <span className="font-bold text-[11px]">{eq.label}</span>
                              <div className="flex items-center gap-1.5">
                                <img src={eq.recipe[0]} alt="" className="h-[18px] w-[18px] rounded border border-base" />
                                <span className="text-faint text-xs leading-none">+</span>
                                <img src={eq.recipe[1]} alt="" className="h-[18px] w-[18px] rounded border border-base" />
                              </div>
                            </div>
                          ) : eq.label
                        }>
                          <img
                            src={eq.icon}
                            alt=""
                            loading="lazy"
                            className="h-[17px] w-[17px] shrink-0 rounded border border-base bg-base object-cover"
                          />
                        </Tip>
                      ) : null)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 右端：指標ブロック（平均順位をヒーロー化） */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-line px-4 py-3 sm:justify-end sm:gap-5 sm:border-l sm:border-t-0 sm:py-0">
          {/* ヒーロー: 平均順位（ティア色） */}
          <div className="flex items-center gap-2.5">
            <span
              className={`${tier.classes} flex h-7 w-7 items-center justify-center rounded-md text-sm font-extrabold shadow-sm`}
            >
              {tier.label}
            </span>
            <div className="flex flex-col">
              <span className="mb-0.5 text-[10px] font-medium uppercase tracking-wide leading-none text-faint">
                {t(lang, 'avg')}
              </span>
              <span
                className="text-[26px] font-extrabold leading-none tabular-nums"
                style={{ color: tier.color }}
              >
                {hasPlace ? avgPlace.toFixed(2) : '—'}
              </span>
            </div>
          </div>

          {/* 副指標 */}
          <div className="flex items-center gap-0.5">
            {statCell(sortKey === 'top4', t(lang, 'metricTop4'), `${top4Rate.toFixed(1)}%`)}
            {statCell(sortKey === 'win', t(lang, 'metricWin'), `${winRate.toFixed(1)}%`)}
            {statCell(sortKey === 'adopt', t(lang, 'metricRate'), `${usage.adopt}`)}
          </div>

          {/* コードコピーボタン */}
          <button
            type="button"
            onClick={copy}
            className="hidden h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-muted transition-colors hover:border-line-strong hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 sm:flex"
            title={t(lang, 'copyCodeTitle')}
          >
            {copied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
