import type { CompStats, StatsFile } from '../../shared/types'
import { compUsage, type CompUsage } from '../lib/multiset'
import { t, type Lang } from '../lib/i18n'
import { CompCard, type SortKey } from './CompCard'

interface CompListProps {
  stats: StatsFile
  /** 表示対象の構成（App でレベル＝盤面ユニット数フィルタ済み）。 */
  comps: CompStats[]
  sel: number[]
  sortKey: SortKey
  /** 採用数（該当レコード数）の下限。 */
  minAdopt: number
  lang: Lang
}

/** 統計の信頼性のための最小サンプル（該当レコードがこの未満は除外）。 */
const MIN_SAMPLE = 3

export function CompList({ stats, comps, sel, sortKey, minAdopt, lang }: CompListProps) {
  if (sel.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-16 text-center text-sm text-zinc-400">
        <svg
          className="h-10 w-10 text-zinc-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        {t(lang, 'selectEmblemHintLeft')}
      </div>
    )
  }

  const floor = Math.max(MIN_SAMPLE, minAdopt)

  const rows = comps
    .map((comp) => ({ comp, usage: compUsage(comp, sel) }))
    .filter((r): r is { comp: CompStats; usage: CompUsage } => r.usage !== null && r.usage.adopt >= floor)

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-sm text-zinc-400">
        {t(lang, 'noCompsAdopt', { x: floor })}
      </div>
    )
  }

  // グループ内ソート（選択中の指標）。
  const cmp = (a: CompUsage, b: CompUsage): number => {
    switch (sortKey) {
      case 'place':
        return a.p / a.adopt - b.p / b.adopt // 平均順位 昇順
      case 'win':
        return b.win / b.adopt - a.win / a.adopt
      case 'adopt':
        return b.adopt - a.adopt
      case 'top4':
      default:
        return b.top4 / b.adopt - a.top4 / a.adopt
    }
  }

  // 活用 X でグループ化（N は選択数で一定）。X 降順でグループ表示、群内は指標でソート。
  const N = rows[0].usage.n
  const byX = new Map<number, { comp: CompStats; usage: CompUsage }[]>()
  for (const r of rows) {
    const arr = byX.get(r.usage.x) ?? []
    arr.push(r)
    byX.set(r.usage.x, arr)
  }
  const groups = [...byX.entries()].sort((a, b) => b[0] - a[0])
  for (const [, arr] of groups) arr.sort((a, b) => cmp(a.usage, b.usage))

  // X の表示（整数はそのまま、0.5 刻みは小数1桁）。
  const fmtX = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1 text-xs font-medium text-zinc-500">
        {t(lang, 'resultCount', { n: rows.length })}
      </div>
      {groups.map(([x, arr]) => (
        <div key={x} className="flex flex-col gap-2">
          {N >= 1 && (
            <div className="flex items-center gap-2 px-1">
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/30">
                {t(lang, 'utilization', { n: fmtX(x), k: N })}
              </span>
              <span className="text-[11px] text-zinc-500">{t(lang, 'resultCount', { n: arr.length })}</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>
          )}
          {arr.map(({ comp, usage }) => (
            <CompCard
              key={comp.units.join(',')}
              stats={stats}
              comp={comp}
              usage={usage}
              selList={[...new Set(sel)]}
              sortKey={sortKey}
              lang={lang}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
