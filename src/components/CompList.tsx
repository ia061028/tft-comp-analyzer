import type { CompStats, StatsFile } from '../../shared/types'
import { aggregateUtilized } from '../lib/multiset'
import { t, type Lang } from '../lib/i18n'
import { CompCard, type SortKey } from './CompCard'

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

export function CompList({ stats, comps, sel, sortKey, ratePct, lang }: CompListProps) {
  // 紋章未選択時は一覧を出さず案内のみ。
  if (sel.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-16 text-center text-sm text-zinc-400">
        <span className="text-3xl opacity-60" aria-hidden>
          🏅
        </span>
        {t(lang, 'selectEmblemHintLeft')}
      </div>
    )
  }

  const selList = [...new Set(sel)]
  const K = selList.length

  const rows = comps
    .map((comp) => {
      // 同時装着ベース集計: 選択紋章を最大数だけ一緒に装着できた深さ(usedCount)と、
      // その深さを達成したゲームのみで成績を合算（agg）。
      const agg = aggregateUtilized(comp, selList)
      const usedCount = agg.usedCount
      // p が無い（古い stats.json）場合 agg.p は NaN になりうるため有限性を判定。
      const avgPlace = agg.n > 0 && Number.isFinite(agg.p) ? agg.p / agg.n : NaN
      // 採用率: この構成のゲームのうち、活用した紋章（同時装着分）を装備していた割合。
      const usageRate = comp.n > 0 ? agg.n / comp.n : 0
      return { comp, agg, avgPlace, usageRate, usedCount }
    })
    // 採用率がしきい値以上、かつ選択紋章を1種以上実際に使用、かつ最小サンプル以上。
    .filter(
      ({ agg, usageRate, usedCount }) =>
        agg.n >= MIN_SAMPLE && usageRate * 100 >= ratePct && usedCount >= 1,
    )
    .sort((a, b) => {
      // 同時装着優先: 一緒に使える数が多い構成を上位へ。
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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-sm text-zinc-400">
        {t(lang, 'noCompsRate', { x: ratePct })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map(({ comp, agg, avgPlace, usedCount }) => (
        <CompCard
          key={comp.label + '|' + comp.traits.map((tr) => tr[0]).join(',')}
          stats={stats}
          comp={comp}
          agg={agg}
          avgPlace={avgPlace}
          usedCount={usedCount}
          k={K}
          selList={selList}
          sortKey={sortKey}
          lang={lang}
        />
      ))}
    </div>
  )
}
