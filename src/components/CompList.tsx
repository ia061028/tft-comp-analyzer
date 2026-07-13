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
  /** 選択紋章を1枚残らず使う構成だけに絞る。OFF なら一部だけ使う構成も出す（＝見比べ用）。 */
  fullUseOnly: boolean
  /** 「すべて使う」を解除する導線（0件時の回復操作）。 */
  onDisableFullUse: () => void
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
  fullUseOnly,
  onDisableFullUse,
}: CompListProps) {
  const { units, emblems, traits } = stats

  const floor = Math.max(MIN_SAMPLE, minAdopt)

  // 1構成は「紋章の積み方」ごとに複数行へ分解される（2枚使う行と1枚だけ使う行は別カード）。
  // compRows / activeTraitCounts / bronzeTraitCount は構成数×選択紋章に比例して重いため、
  // comps・sel・floor・stats の該当サブフィールドが変わらない限り再計算しない。
  // 採用数下限までを適用した行。「すべて使う」の絞り込みはまだ掛けない —
  // 0件になったときに原因（採用数下限 なのか すべて使う なのか）を切り分けるために必要。
  const rowsBeforeFullUse = useMemo<Row[]>(() => {
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

  const rows = useMemo<Row[]>(
    () =>
      fullUseOnly
        ? rowsBeforeFullUse.filter(({ row }) => row.match >= sel.length)
        : rowsBeforeFullUse,
    [rowsBeforeFullUse, fullUseOnly, sel.length],
  )

  // 並び順は「選んだ指標」が第1キー。同点は 平均順位 → 1位率 → Top4率 → 採用数 の順で決める。
  //
  // 以前は活用紋章数を第1キーにしていたが、それだと「Top4率」を選んでも活用数で層が分かれ、
  // 画面上は Top4率 の降順に見えない。ランキングの軸が信用できないと「どれが一番良いか」を
  // 判断できないので、絞り込み（＝すべて使うか）と順位付け（＝どの指標か）を分離した。
  //
  // 率は縮約値で比較する（生の率だと採用5件の 80% が採用500件の 62% より上に来る）。
  // 表示する数字は生の率のまま。詳細は format.ts の shrunk を参照。
  const sorted = useMemo(() => {
    // すべて「小さいほど良い」に符号を揃える。
    const metric = (r: CompRow, key: SortKey): number => {
      switch (key) {
        case 'place':
          return shrunk(r.p, r.n, PRIOR_PLACE) // 順位は小さいほど良いのでそのまま
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
        const d = metric(a.row, k) - metric(b.row, k)
        if (d !== 0) return d
      }
      return 0
    })
  }, [rows, sortKey, bronzeMode])

  // 上位を「コア ＋ 派生」の系統に畳む。コアが取れない行は flat に落ちて従来カードで描かれる。
  const tree = useMemo(
    () => buildTree(sorted, units, emblems, traits),
    [sorted, units, emblems, traits],
  )

  // 平均順位の**色**の根拠にだけ使う（数値も見出しも画面には出さない）。
  // 絶対値でティアを切ると 10体グループが全部 S になり、色が情報を運ばなくなるため。
  const cohort = useMemo(() => cohortPlace(stats.comps), [stats.comps])

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
    // 0件の原因は2つしかない。取り違えると回復操作を間違えるので、原因ごとに導線を出し分ける。
    // 「すべて使う」を外せば行が戻ってくる場合だけが「すべて使う」起因。そうでなければ採用数下限。
    const byFullUse = fullUseOnly && rowsBeforeFullUse.length > 0
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface/40 px-4 py-10 text-center text-sm text-muted">
        {byFullUse
          ? t(lang, 'noCompsFullUse', { n: sel.length, x: floor })
          : t(lang, 'noCompsAdopt', { x: floor })}
        {byFullUse && (
          <button
            type="button"
            onClick={onDisableFullUse}
            className="rounded-md border border-line-strong bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-faint hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            {t(lang, 'noCompsFullUseAction')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1 text-xs font-medium text-faint">
        {t(lang, 'resultCount', { n: sorted.length })}
      </div>

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
              showUtilization={sel.length > 1 && !fullUseOnly}
            />
          ))}
        </div>
      )}
    </div>
  )
}
