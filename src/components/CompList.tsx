import { useState } from 'react'
import type { CompStats, StatsFile, UnitInfo } from '../../shared/types'
import { aggregateAny, emblemGames } from '../lib/multiset'
import { pickName, t, type Lang } from '../lib/i18n'
import { Tip } from './Tip'

type SortKey = 'rate' | 'place' | 'top4' | 'win'

interface CompListProps {
  stats: StatsFile
  /** 表示する構成（全体 or レベル別。App で選択済み） */
  comps: CompStats[]
  sel: number[]
  sortKey: SortKey
  /** 採用率(%)の下限しきい値 */
  ratePct: number
  lang: Lang
}

/** 統計の信頼性のための最小サンプル（採用率が高くても n がこれ未満なら除外）。 */
const MIN_SAMPLE = 3

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


/**
 * チームプランナーの貼付コード（現行 02 形式）:
 * `02` + 10スロット×「team_planner_code を12bit=3桁hex(big-endian)」 + `TFTSet{N}`。空き枠は `000`。
 * （旧 01 形式は8bit/2桁だが、グローバルIDが255を超えるため12bit形式に変更されている）
 */
function buildPlannerCode(unitIdxs: number[], units: UnitInfo[], setNumber: number): string {
  const slots: string[] = []
  for (const idx of unitIdxs) {
    const code = units[idx]?.code ?? 0
    if (code > 0) slots.push(code.toString(16).padStart(3, '0'))
  }
  while (slots.length < 10) slots.push('000')
  return '02' + slots.slice(0, 10).join('') + 'TFTSet' + setNumber
}

export function CompList({ stats, comps, sel, sortKey, ratePct, lang }: CompListProps) {
  const { traits, units, emblems, items } = stats
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // 選択中の紋章。装備者ハイライトに使う。
  const selectedEmblemSet = new Set(sel)

  // 紋章未選択時は一覧を出さず案内のみ。
  if (sel.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-12 text-center text-sm text-zinc-400">
        {t(lang, 'selectEmblemHintLeft')}
      </div>
    )
  }

  const selList = [...new Set(sel)]
  const K = selList.length

  const rows = comps
    .map((comp) => {
      // OR集計: いずれかの選択紋章を装備していたゲーム。
      const agg = aggregateAny(comp, selList)
      // p が無い（古い stats.json）場合 agg.p は NaN になりうるため有限性を判定。
      const avgPlace = agg.n > 0 && Number.isFinite(agg.p) ? agg.p / agg.n : NaN
      // OR採用率: この構成のゲームのうち、いずれかの選択紋章を装備していた割合。
      const usageRate = comp.n > 0 ? agg.n / comp.n : 0
      // 活用度: 選択紋章のうち、実際にこの構成で1ゲーム以上使われている数（ratePctと無関係）。
      let usedCount = 0
      for (const e of selList) {
        if (emblemGames(comp, e) > 0) usedCount++
      }
      return { comp, agg, avgPlace, usageRate, usedCount }
    })
    // OR採用率がしきい値以上、かつ選択紋章を1種以上実際に使用、かつ最小サンプル以上。
    .filter(({ agg, usageRate, usedCount }) => agg.n >= MIN_SAMPLE && usageRate * 100 >= ratePct && usedCount >= 1)
    .sort((a, b) => {
      // AND優先: 活用数が多い構成（全部使う構成）を上位へ。
      if (b.usedCount !== a.usedCount) return b.usedCount - a.usedCount
      switch (sortKey) {
        case 'place': {
          // 昇順（小さいほど良い）。平均順位不明（NaN）は末尾へ。
          const av = Number.isFinite(a.avgPlace) ? a.avgPlace : Infinity
          const bv = Number.isFinite(b.avgPlace) ? b.avgPlace : Infinity
          return av - bv
        }
        case 'win':
          return b.agg.win / b.agg.n - a.agg.win / a.agg.n
        case 'top4':
          return b.agg.top4 / b.agg.n - a.agg.top4 / a.agg.n
        case 'rate':
        default:
          return b.usageRate - a.usageRate
      }
    })

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center text-sm text-zinc-400">
        {t(lang, 'noCompsRate', { x: ratePct })}
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
      {rows.map(({ comp, agg, avgPlace, usedCount }) => {
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
              title={
                hasPlace
                  ? t(lang, 'tierTitle', { x: avgPlace.toFixed(2) })
                  : t(lang, 'tierNoData')
              }
            >
              {tier.label}
            </div>

            {/* 構成本体 */}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 truncate text-base font-semibold text-zinc-100">
                  {compName}
                </span>
                {K >= 2 && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      usedCount >= K
                        ? 'bg-amber-400 text-zinc-950'
                        : 'bg-zinc-700/70 text-amber-200'
                    }`}
                    title={t(lang, 'utilizationTitle')}
                  >
                    {t(lang, 'utilization', { n: usedCount, k: K })}
                  </span>
                )}
                <span className="shrink-0 rounded bg-zinc-700/70 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-200">
                  {t(lang, 'activeTraits', { n: (comp.synergies ?? comp.traits).length })}
                </span>
              </div>

              {/* 発動中の特性のみの行 */}
              <div className="mb-2 flex flex-wrap items-center gap-1">
                {(comp.synergies ?? comp.traits).map(([traitIdx, style, count]) => {
                  const trait = traits[traitIdx]
                  return (
                    <Tip key={traitIdx} label={trait ? pickName(lang, trait) : `#${traitIdx}`}>
                      <span
                        className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs font-semibold ${styleClasses(
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
                        {count ? <span className="rounded bg-zinc-950/40 px-1 text-xs font-bold tabular-nums">{count}</span> : null}
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
                  const unitItemIdxs = comp.unitItems
                    .filter((ui) => ui[0] === unitIdx)
                    .map((ui) => ui[1])
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
                          className={`h-14 w-14 rounded border-2 object-cover ${costBorder(unit.cost)}`}
                        />
                      </Tip>
                      {hasUnder && (
                        <div className="flex flex-col items-center gap-0.5">
                          {unitItemIdxs.length > 0 && (
                            <div className="grid grid-cols-3 justify-items-center gap-0.5">
                              {unitItemIdxs.map((ii, k) => {
                                const item = items?.[ii]
                                if (!item) return null
                                return (
                                  <Tip key={`i${ii}-${k}`} label={pickName(lang, item)}>
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
                                      className={`h-5 w-5 object-contain ${
                                        selectedEmblemSet.has(ei) ? 'rounded ring-1 ring-amber-400' : ''
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
                onClick={() => copy(key, code)}
                className="mt-0.5 rounded border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                title={t(lang, 'copyCodeTitle')}
              >
                {copiedKey === key ? t(lang, 'copied') : t(lang, 'copyCode')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
