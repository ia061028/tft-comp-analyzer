import { useMemo } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import { compUsages, type CompUsage } from '../lib/multiset'
import { activeTraitCounts, bronzeTraitCount } from '../lib/format'
import { t, type Lang } from '../lib/i18n'
import { CompCard, type SortKey } from './CompCard'

interface CompListProps {
  stats: StatsFile
  /** 表示対象の構成（App で盤面ユニット数フィルタ済み）。 */
  comps: CompStats[]
  sel: number[]
  sortKey: SortKey
  /** 採用数（該当レコード数）の下限。 */
  minAdopt: number
  lang: Lang
  /** 生涯ブロンズモード: ブロンズ特性数でグループ化・降順表示。 */
  bronzeMode: boolean
}

/** 統計の信頼性のための最小サンプル（該当レコードがこの未満は除外）。 */
const MIN_SAMPLE = 3

type Row = {
  comp: CompStats
  usage: CompUsage
  /** 発動特性数（盤面所持 ＋ 活用紋章の付与分）。CompCard と共有し二重計算を避ける。 */
  traitCount: Map<number, number>
  /** 生涯ブロンズ数。CompCard と共有し二重計算を避ける。 */
  bronze: number
}

export function CompList({ stats, comps, sel, sortKey, minAdopt, lang, bronzeMode }: CompListProps) {
  const { units, emblems, traits } = stats

  const floor = Math.max(MIN_SAMPLE, minAdopt)

  // 1構成は「紋章の活用の仕方」ごとに複数行へ分解される（活用2/2 の行と活用1/2 の行は別カード）。
  // compUsages / activeTraitCounts / bronzeTraitCount は構成数×選択紋章に比例して重いため、
  // comps・sel・floor・stats の該当サブフィールドが変わらない限り再計算しない。
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const comp of comps) {
      for (const usage of compUsages(comp, sel)) {
        if (usage.adopt < floor) continue
        const traitCount = activeTraitCounts(comp, usage, units, emblems)
        const bronze = bronzeTraitCount(traitCount, traits)
        out.push({ comp, usage, traitCount, bronze })
      }
    }
    return out
  }, [comps, sel, floor, units, emblems, traits])

  // グループ化・ソートは rows が変わらなければ再計算不要（sortKey/bronzeMode 変更時のみ）。
  const groups = useMemo(() => {
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

    // グループ化キー: 通常は活用 X、生涯ブロンズ時はブロンズ特性数。どちらも降順表示・群内は指標ソート。
    const byKey = new Map<number, Row[]>()
    for (const r of rows) {
      const key = bronzeMode ? r.bronze : r.usage.x
      const arr = byKey.get(key) ?? []
      arr.push(r)
      byKey.set(key, arr)
    }
    const g = [...byKey.entries()].sort((a, b) => b[0] - a[0])
    for (const [, arr] of g) arr.sort((a, b) => cmp(a.usage, b.usage))
    return g
  }, [rows, sortKey, bronzeMode])

  if (sel.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface/40 px-4 py-16 text-center text-sm text-muted">
        <svg
          className="h-10 w-10 text-faint"
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

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface/40 px-4 py-10 text-center text-sm text-muted">
        {t(lang, 'noCompsAdopt', { x: floor })}
      </div>
    )
  }

  // X の表示（整数はそのまま、0.5 刻みは小数1桁）。
  const fmtX = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))
  const N = sel.length

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1 text-xs font-medium text-faint">
        {t(lang, 'resultCount', { n: rows.length })}
      </div>
      {groups.map(([x, arr]) => (
        <div key={x} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <span
              title={bronzeMode ? t(lang, 'bronzeModeTitle') : t(lang, 'utilizationTitle')}
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 tabular-nums ${
                bronzeMode
                  ? 'bg-bronze/15 text-[#e3b6a6] ring-bronze/40'
                  : 'bg-gold/12 text-gold ring-gold/30'
              }`}
            >
              {bronzeMode ? t(lang, 'bronzeGroup', { n: x }) : t(lang, 'utilization', { n: fmtX(x), k: N })}
            </span>
            <span className="text-[11px] text-faint tabular-nums">{t(lang, 'resultCount', { n: arr.length })}</span>
            <div className="h-px flex-1 bg-line" />
          </div>
          {/* 同一盤面でも活用の仕方（usage.key）が違えば別カード。キーに両方を含める。 */}
          {arr.map(({ comp, usage, traitCount, bronze }) => (
            <CompCard
              key={`${comp.units.join(',')}|${usage.key}`}
              stats={stats}
              comp={comp}
              usage={usage}
              traitCount={traitCount}
              bronze={bronze}
              sortKey={sortKey}
              lang={lang}
              bronzeMode={bronzeMode}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
