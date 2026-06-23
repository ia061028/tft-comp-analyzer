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

/** 構成一覧の1カード。MetaTFTライクなUI */
export function CompCard({ stats, comp, usage, selList, sortKey, lang }: CompCardProps) {
  const { traits, units, emblems, items } = stats
  const [copied, setCopied] = useState(false)
  const selectedEmblemSet = new Set(selList)

  const avgPlace = usage.adopt > 0 ? usage.p / usage.adopt : NaN
  const hasPlace = Number.isFinite(avgPlace)
  const tier = hasPlace ? tierOf(avgPlace) : { label: '?', color: '#666666', classes: 'bg-[#666666] text-white' }
  const code = buildPlannerCode(comp.units, units, stats.setNumber)

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

  // 指標のハイライト判定
  const isGoodPlace = avgPlace <= 4.3
  const winRate = usage.adopt > 0 ? (usage.win / usage.adopt) * 100 : 0
  const top4Rate = usage.adopt > 0 ? (usage.top4 / usage.adopt) * 100 : 0

  return (
    <div className="my-2 flex flex-col rounded-[2px_5px_5px_2px] bg-gradient-to-b from-[#27282b] to-[#222326] shadow-md transition-transform hover:translate-y-[-1px]">
      <div
        className="flex min-h-[100px] flex-col sm:flex-row items-stretch"
        style={{ borderLeft: `5px solid ${tier.color}` }}
      >
        {/* 左端：ティアバッジ */}
        <div className="hidden sm:flex w-[27px] shrink-0 mx-3 my-auto items-center justify-center rounded-[3px] h-[89.5px] font-bold text-[13px] shadow-sm" className={tier.classes + " hidden sm:flex w-[27px] shrink-0 mx-3 my-auto items-center justify-center rounded-[3px] h-[89.5px] font-bold text-[13px] shadow-sm"}>
          {tier.label}
        </div>

        {/* 中央：特性とチャンピオン */}
        <div className="flex-1 flex flex-col justify-center py-3 px-3 sm:px-0 min-w-0 border-b border-[#333] sm:border-b-0 sm:border-r border-dashed">
          {/* 特性バッジ */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            <span className="sm:hidden mr-1 px-1.5 py-0.5 rounded text-xs font-bold" className={tier.classes + " sm:hidden mr-1 px-1.5 py-0.5 rounded text-xs font-bold"}>{tier.label}</span>
            {traitChips.map(([traitIdx, style, count]) => {
              const trait = traits[traitIdx]
              return (
                <Tip key={traitIdx} label={trait ? pickName(lang, trait) : `#${traitIdx}`}>
                  <span
                    className={`inline-flex items-center gap-1 h-[18.5px] px-1.5 text-[11px] font-semibold rounded-[4px] border ${styleClasses(
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
          <div className="flex flex-wrap gap-x-2.5 gap-y-3">
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
              
              // 全ての装備アイテム（通常アイテム + 紋章）
              const allEquips = [
                ...unitItemIdxs.map(ii => ({ icon: items?.[ii]?.icon, label: pickName(lang, items?.[ii]!) })),
                ...unitEmblemIdxs.map(ei => ({ icon: emblems[ei]?.icon, label: pickName(lang, emblems[ei]!) }))
              ]

              return (
                <div key={unitIdx} className="flex flex-col items-center w-[42px]">
                  {/* スター（画像の上に配置、11px） */}
                  <div className={`h-2.5 text-[11px] leading-none mb-0.5 ${starColor(star)} tracking-[1px]`}>
                    {star > 0 ? '★'.repeat(star) : ''}
                  </div>
                  
                  {/* チャンピオンアイコン（42x42, 角丸3px） */}
                  <Tip label={star > 0 ? `${unitName} ★${star}` : unitName}>
                    <img
                      src={unit.icon}
                      alt={unitName}
                      loading="lazy"
                      className={`h-[42px] w-[42px] rounded-[3px] border-2 object-cover ${costBorder(unit.cost)}`}
                    />
                  </Tip>

                  {/* アイテム（チャンピオン画像の下部にめり込む） */}
                  <div className="flex justify-center -mt-[12px] z-10 w-[42px] px-0.5 gap-[1px]">
                    {allEquips.map((eq, idx) => eq.icon ? (
                      <Tip key={idx} label={eq.label}>
                        <img
                          src={eq.icon}
                          alt=""
                          loading="lazy"
                          className="h-[15px] w-[15px] rounded-[2px] border border-[#111] object-cover bg-black"
                        />
                      </Tip>
                    ) : null)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右端：指標ブロック */}
        <div className="flex shrink-0 items-center gap-x-6 sm:gap-x-8 px-4 py-3 sm:py-0 justify-between sm:justify-end">
          <div className="flex flex-col text-center sm:text-right">
            <span className="text-[12px] text-[#aaaaaa] mb-1">{t(lang, 'avg')}</span>
            <span className={`text-[16px] font-bold ${isGoodPlace ? 'text-[#bffe7f]' : 'text-[#ede9ca]'}`}>
              {hasPlace ? avgPlace.toFixed(2) : '—'}
            </span>
          </div>

          <div className="flex flex-col text-center sm:text-right">
            <span className="text-[12px] text-[#aaaaaa] mb-1">{t(lang, 'metricTop4')}</span>
            <span className="text-[14px] font-bold text-[#ede9ca]">{top4Rate.toFixed(1)}%</span>
          </div>

          <div className="flex flex-col text-center sm:text-right">
            <span className="text-[12px] text-[#aaaaaa] mb-1">{t(lang, 'metricWin')}</span>
            <span className="text-[14px] font-bold text-[#ede9ca]">{winRate.toFixed(1)}%</span>
          </div>

          <div className="flex flex-col text-center sm:text-right">
            <span className="text-[12px] text-[#aaaaaa] mb-1">{t(lang, 'metricRate')}</span>
            <span className="text-[14px] font-bold text-[#ede9ca]">{usage.adopt}</span>
          </div>

          {/* コードコピーボタン */}
          <div className="hidden lg:flex flex-col items-center justify-center ml-2">
            <button
              type="button"
              onClick={copy}
              className="flex h-[32px] items-center justify-center rounded bg-[#36383e] hover:bg-[#46484e] px-3 text-[12px] font-bold text-[#eeeeee] transition-colors"
              title={t(lang, 'copyCodeTitle')}
            >
              {copied ? `✓` : t(lang, 'copyCode')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
