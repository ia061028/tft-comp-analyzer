import { useMemo } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import { compRows, type CompRow } from '../lib/multiset'
import {
  activeTraitCounts,
  bronzeTraitCount,
  cohortPlace,
  shrunk,
  PRIOR_PLACE,
  PRIOR_TOP4,
  PRIOR_WIN,
} from '../lib/format'
import { buildTree } from '../lib/backbone'
import { t, type Lang } from '../lib/i18n'
import { CompCard, type SortKey } from './CompCard'
import { FamilyCard } from './FamilyCard'

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
}

/** 統計の信頼性のための最小サンプル。採用数下限の入力欄の下限値でもある（App が参照）。 */
export const MIN_SAMPLE = 3

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
}: CompListProps) {
  const { units, emblems, traits } = stats

  // 下限は入力欄側で MIN_SAMPLE 未満にできないので、ここでは素直に使う。
  const floor = minAdopt

  // 1構成は「紋章の積み方」ごとに複数行へ分解される（2枚使う行と1枚だけ使う行は別カード）。
  // compRows / activeTraitCounts / bronzeTraitCount は構成数×選択紋章に比例して重いため、
  // comps・sel・floor・stats の該当サブフィールドが変わらない限り再計算しない。
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const comp of comps) {
      for (const row of compRows(comp, sel)) {
        if (row.n < floor) continue
        const traitCount = activeTraitCounts(comp, row.used, units, emblems)
        const bronze = bronzeTraitCount(traitCount, traits)
        out.push({ comp, row, traitCount, bronze })
      }
    }
    return out
  }, [comps, sel, floor, units, emblems, traits])

  // 同体数コホートの平均順位。Tier バッジの色と、Tier順ソートの両方の基準にする。
  // 絶対値で切ると 10体グループが全部 S になり、色も順位も情報を運ばなくなる。
  const cohort = useMemo(() => cohortPlace(stats.comps), [stats.comps])

  // 並び順は「選んだ指標」が第1キー。同点は Tier → 1位率 → Top4率 → 採用数 の順で決める。
  //
  // 以前は活用紋章数を第1キーにしていたが、それだと「Top4率」を選んでも活用数で層が分かれ、
  // 画面上は Top4率 の降順に見えない。ランキングの軸が信用できないと「どれが一番良いか」を
  // 判断できないので、絞り込みと順位付け（＝どの指標か）を分離した。
  //
  // 'place'（＝Tier）は**同体数コホートからの差**で測る。素の平均順位で並べると体数の多い順に
  // なるだけで（実測 7体=5.28 … 10体=1.76）、「10体まで揃えろ」以上のことを言わない一覧になる。
  // カードの Tier バッジも同じ基準（tierOfEdge）なので、これで表示と並び順が一致する。
  //
  // 率は縮約値で比較する（生の率だと採用5件の 80% が採用500件の 62% より上に来る）。
  // 表示する数字は生の率のまま。詳細は format.ts の shrunk を参照。
  const sorted = useMemo(() => {
    // すべて「小さいほど良い」に符号を揃える。
    const metric = (r: CompRow, unitCount: number, key: SortKey): number => {
      switch (key) {
        case 'place': {
          // 同体数の平均を事前分布に使い、そこからの差を取る。順位は小さいほど良いのでそのまま。
          const base = cohort.get(unitCount) ?? PRIOR_PLACE
          return shrunk(r.p, r.n, base) - base
        }
        case 'win':
          return -shrunk(r.win, r.n, PRIOR_WIN)
        case 'adopt':
          return -r.n // 採用数そのものは縮約しない
        case 'top4':
        default:
          return -shrunk(r.top4, r.n, PRIOR_TOP4)
      }
    }
    // 同点の決着は常にこの優先順。選択中の指標を先頭に置き、残りをこの順で後ろに繋ぐ。
    const PRIORITY: SortKey[] = ['place', 'win', 'top4', 'adopt']
    const keys = [sortKey, ...PRIORITY.filter((k) => k !== sortKey)]

    return rows.slice().sort((a, b) => {
      if (bronzeMode && a.bronze !== b.bronze) return b.bronze - a.bronze
      for (const k of keys) {
        const d = metric(a.row, a.comp.units.length, k) - metric(b.row, b.comp.units.length, k)
        if (d !== 0) return d
      }
      return 0
    })
  }, [rows, sortKey, bronzeMode, cohort])

  // 紋章を2枚以上選んでいるときは「選択を全部使う構成」と「一部だけ使う構成」に分ける。
  // 全部使う組み合わせは実データでは稀（8,483マッチ時点で採用数5以上は11件）だが、
  // 稀だからこそ探せる形にしておく必要がある。並び順に混ぜると49件のリストに埋もれる。
  // 各セクションの中は選択中の指標で素直に並ぶので、ランキングの軸も壊れない。
  const sections = useMemo(() => {
    if (sel.length <= 1) return [{ key: 'all' as const, rows: sorted }]
    return [
      { key: 'full' as const, rows: sorted.filter((r) => r.row.match >= sel.length) },
      { key: 'partial' as const, rows: sorted.filter((r) => r.row.match < sel.length) },
    ]
  }, [sorted, sel.length])

  // 上位を「コア ＋ 派生」の系統に畳む。コアが取れない行は flat に落ちて従来カードで描かれる。
  // セクションごとに畳む（TOP_N はセクション単位で効く）。
  const trees = useMemo(
    () => sections.map((s) => ({ ...s, tree: buildTree(s.rows, units, emblems, traits) })),
    [sections, units, emblems, traits],
  )

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
    // 0件の原因は採用数下限だけ（選択紋章を1枚も使わない行はデータ上存在しないため）。
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface/40 px-4 py-10 text-center text-sm text-muted">
        {t(lang, 'noCompsAdopt', { x: floor })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1 text-xs font-medium text-faint">
        {t(lang, 'resultCount', { n: sorted.length })}
      </div>

      {trees.map(({ key, rows: sectionRows, tree }) => (
        <div key={key} className="flex flex-col gap-3">
          {key !== 'all' && (
            <div className="flex items-baseline gap-2 border-l-2 border-gold/50 pl-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">
                {key === 'full'
                  ? t(lang, 'sectionFullUse', { n: sel.length })
                  : t(lang, 'sectionPartialUse')}
              </span>
              <span className="text-xs text-faint">{sectionRows.length}</span>
            </div>
          )}

          {/* 全部使う構成が1件も無いときは、空欄にせず理由を1行だけ出す。 */}
          {key === 'full' && sectionRows.length === 0 && (
            <div className="rounded-lg border border-dashed border-line bg-surface/40 px-3 py-3 text-xs text-muted">
              {t(lang, 'noFullUse', { n: sel.length, x: floor })}
            </div>
          )}

          {/* 系統（背骨＋派生）。上位のほぼ同一な構成がここに畳まれる。 */}
          {tree.families.length > 0 && (
            <div className="flex flex-col gap-3">
              {tree.families.map((family) => (
                <FamilyCard
                  key={family.backbone.join(',')}
                  stats={stats}
                  family={family}
                  cohort={cohort}
                  lang={lang}
                />
              ))}
            </div>
          )}

          {/* 背骨が取れなかった行と、上位N件から外れた行。従来のフルカードで描く。 */}
          {tree.flat.length > 0 && (
            <div className="flex flex-col gap-2">
              {tree.families.length > 0 && (
                <div className="px-1 text-xs font-medium text-faint">
                  {t(lang, 'otherComps', { n: tree.flat.length })}
                </div>
              )}
              {/* 同一盤面でも紋章の使われ方（row.used）が違えば別カード。キーに両方を含める。 */}
              {tree.flat.map(({ comp, row, traitCount, bronze }) => (
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
                  showUtilization={sel.length > 1}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}