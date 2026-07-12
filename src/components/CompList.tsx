import { useMemo } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import { compRows, type CompRow } from '../lib/multiset'
import {
  activeTraitCounts,
  bronzeTraitCount,
  shrunk,
  PRIOR_PLACE,
  PRIOR_TOP4,
  PRIOR_WIN,
} from '../lib/format'
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
  /** 生涯ブロンズモード: ブロンズ特性数の多い順に並べる。 */
  bronzeMode: boolean
  /** 選択紋章のみモード: 手持ちを超える紋章を活用した試合を母数から除外。 */
  strict: boolean
}

/** 統計の信頼性のための最小サンプル（該当レコードがこの未満は除外）。 */
const MIN_SAMPLE = 3

type Row = {
  comp: CompStats
  row: CompRow
  /** 発動特性数（盤面所持 ＋ 活用紋章の付与分）。CompCard と共有し二重計算を避ける。 */
  traitCount: Map<number, number>
  /** 生涯ブロンズ数。CompCard と共有し二重計算を避ける。 */
  bronze: number
}

export function CompList({
  stats,
  comps,
  sel,
  sortKey,
  minAdopt,
  lang,
  bronzeMode,
  strict,
}: CompListProps) {
  const { units, emblems, traits } = stats

  const floor = Math.max(MIN_SAMPLE, minAdopt)

  // 1構成は「選択紋章の使われ方」ごとに複数行へ分解される（2枚使う行と1枚だけ使う行は別カード）。
  // compRows / activeTraitCounts / bronzeTraitCount は構成数×選択紋章に比例して重いため、
  // comps・sel・floor・strict・stats の該当サブフィールドが変わらない限り再計算しない。
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const comp of comps) {
      for (const row of compRows(comp, sel, strict)) {
        if (row.n < floor) continue
        const traitCount = activeTraitCounts(comp, row.used, units, emblems)
        const bronze = bronzeTraitCount(traitCount, traits)
        out.push({ comp, row, traitCount, bronze })
      }
    }
    return out
  }, [comps, sel, floor, strict, units, emblems, traits])

  // 並び順: 第1キーは「一致数 降順」（生涯ブロンズ時はブロンズ特性数 降順）、第2キーが指標。
  // 率は縮約値で比較する（生の率だと採用5件の 80% が採用500件の 62% より上に来る）。
  // 表示する数字は生の率のまま。詳細は format.ts の shrunk を参照。
  const sorted = useMemo(() => {
    const metric = (r: CompRow): number => {
      switch (sortKey) {
        case 'place':
          return shrunk(r.p, r.n, PRIOR_PLACE) // 昇順が良い → 後で符号反転せず place のみ別扱い
        case 'win':
          return -shrunk(r.win, r.n, PRIOR_WIN)
        case 'adopt':
          return -r.n // 採用数そのものは縮約しない
        case 'top4':
        default:
          return -shrunk(r.top4, r.n, PRIOR_TOP4)
      }
    }
    return rows
      .slice()
      .sort(
        (a, b) =>
          (bronzeMode ? b.bronze - a.bronze : b.row.match - a.row.match) ||
          metric(a.row) - metric(b.row),
      )
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

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface/40 px-4 py-10 text-center text-sm text-muted">
        {t(lang, 'noCompsAdopt', { x: floor })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1 text-xs font-medium text-faint">
        {t(lang, 'resultCount', { n: sorted.length })}
      </div>
      <div className="flex flex-col gap-2">
        {/* 同一盤面でも紋章の使われ方（row.used）が違えば別カード。キーに両方を含める。 */}
        {sorted.map(({ comp, row, traitCount, bronze }) => (
          <CompCard
            key={`${comp.units.join(',')}|${row.used.join(',')}`}
            stats={stats}
            comp={comp}
            row={row}
            total={sel.length}
            traitCount={traitCount}
            bronze={bronze}
            sortKey={sortKey}
            lang={lang}
            bronzeMode={bronzeMode}
          />
        ))}
      </div>
    </div>
  )
}
