import { useMemo, useState } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import { compRows, type CompRow } from '../lib/multiset'
import {
  DIM_SAMPLE_MAX,
  PRIOR_PLACE,
  PRIOR_TOP4,
  PRIOR_WIN,
  activeTraitCounts,
  activeTraitTotal,
  bronzeTraitCount,
  cohortPlace,
  effectiveUnits,
  shrunk,
} from '../lib/format'
import { TOP_N, buildTree } from '../lib/backbone'
import { t, type Lang } from '../lib/i18n'
import { CompCard, type SortKey } from './CompCard'
import { FamilyCard } from './FamilyCard'

interface CompListProps {
  stats: StatsFile
  /** 表示対象の構成（App で盤面ユニット数フィルタ済み）。 */
  comps: CompStats[]
  sel: number[]
  sortKey: SortKey
  /** 採用数の薄い行を淡く描く（一覧からは消さない）。 */
  dimLowSample: boolean
  lang: Lang
  /** 生涯ブロンズモード: ブロンズ特性数の多い順に並べる。 */
  bronzeMode: boolean
  /** 特性ラダーモード: 発動している特性の種類数の多い順にまとめ、その中を Tier 順に並べる。 */
  ladderMode: boolean
}

/**
 * フルカードで描く一覧を刻む1ページの件数。
 *
 * 採用数下限フィルタを撤廃したので、紋章1枚でも中央値 1,083 行・最大 2,251 行が一覧に載る
 * （18.2b の実データ）。全部を一度に描くと初回表示が重いので、フルカード部分だけページングする。
 * 系統（コア＋派生）は上位 TOP_N 行からしか作られないので刻まない。
 */
export const PAGE_SIZE = 50

type Row = {
  comp: CompStats
  row: CompRow
  /** 発動特性数（盤面所持 ＋ 活用紋章の付与分）。CompCard と共有し二重計算を避ける。 */
  traitCount: Map<number, number>
  /** 生涯ブロンズ数。CompCard と共有し二重計算を避ける。 */
  bronze: number
  /** 発動特性の種類数（固有特性込み）。CompCard と共有し二重計算を避ける。 */
  active: number
}

export function CompList({
  stats,
  comps,
  sel,
  sortKey,
  dimLowSample,
  lang,
  bronzeMode,
  ladderMode,
}: CompListProps) {
  const { units, emblems, traits, granters } = stats

  // 1構成は「紋章の積み方」ごとに複数行へ分解される（2枚使う行と1枚だけ使う行は別カード）。
  //
  // **採用数による足切りはしない。** 下限で消していた頃は、紋章を2枚以上使う構成がほぼ全滅して
  // いた（18.2b の実データで2枚使う行 14,121 件のうち 76% が採用数1、既定の下限5を超えるのは
  // 4.8% だけ）。薄い行は消さず、SampleMeter で「何試合ぶんの話か」を各カードに出し、
  // 邪魔なら dimLowSample で淡くするに留める。極端な率が上位に来る件は並び順側の縮約
  // （format.ts の shrunk）が抑えているので、下限は二重の防御でしかなかった。
  //
  // compRows / activeTraitCounts / bronzeTraitCount は構成数×選択紋章に比例して重いため、
  // comps・sel・stats の該当サブフィールドが変わらない限り再計算しない。
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const comp of comps) {
      for (const row of compRows(comp, sel)) {
        const traitCount = activeTraitCounts(comp, row.used, units, emblems)
        const bronze = bronzeTraitCount(traitCount, traits)
        out.push({ comp, row, traitCount, bronze, active: activeTraitTotal(traitCount, traits) })
      }
    }
    return out
  }, [comps, sel, units, emblems, traits])

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
  // カード（CompCard）も派生行（DerivRow）も Tier バッジは同じ基準（tierOfEdge）で描くので、
  // これで表示と並び順が一致する。cohort はその両方に渡す。
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
      // 特性ラダーは「発動している特性の種類数」でまとめるのが目的なので、それを第1キーにする。
      // 同数の中は下の keys（既定の先頭は Tier）で決まる。
      if (ladderMode && a.active !== b.active) return b.active - a.active
      if (bronzeMode && a.bronze !== b.bronze) return b.bronze - a.bronze
      for (const k of keys) {
        const d = metric(a.row, effectiveUnits(a.comp), k) - metric(b.row, effectiveUnits(b.comp), k)
        if (d !== 0) return d
      }
      return 0
    })
  }, [rows, sortKey, bronzeMode, ladderMode, cohort])

  // 紋章を2枚以上選んでいるときは「何枚を使う構成か」でセクションを分ける。
  // 3枚選んだら「3枚すべて使う」「2枚だけ使う」「1枚だけ使う」の3段になる。
  //
  // 以前は「すべて使う」と「一部だけ使う」の2段しかなく、中間の枚数が1枚使う行に埋もれていた。
  // 18.2b の実データで人気上位3枚を選ぶと、1枚だけ使う行 6,722 に対し2枚使う行は 469 しか
  // なく、しかも1枚組のほうが採用数が多いので並び順でも上に来る。既定の Tier 順だと最初の
  // 2枚組は22位で、系統カードになる上位 TOP_N 行には1つも入らない。「3枚は無理でも2枚なら
  // 組める構成を探す」という普通の使い方が、行は存在するのに事実上できなかった。
  //
  // 「すべて使う」を別セクションに切り出した理由（並び順に混ぜると埋もれる）が中間の枚数にも
  // そのまま当てはまるので、同じ考え方を枚数ごとに広げる。各セクションの中は選択中の指標で
  // 素直に並ぶので、ランキングの軸は壊れない。
  const sections = useMemo(() => {
    if (sel.length <= 1) return [{ key: 'all', match: sel.length, rows: sorted }]
    const out: { key: string; match: number; rows: Row[] }[] = []
    // used は sel の部分多重集合なので match は 1..sel.length に収まる。多い順に並べる。
    for (let m = sel.length; m >= 1; m--) {
      out.push({
        key: m === sel.length ? 'full' : `use${m}`,
        match: m,
        rows: sorted.filter((r) => r.row.match === m),
      })
    }
    return out
  }, [sorted, sel.length])

  // 上位を「コア ＋ 派生」の系統に畳む。コアが取れない行は flat に落ちて従来カードで描かれる。
  // セクションごとに畳む（TOP_N はセクション単位で効く）。
  //
  // **特性ラダーでは畳まない。** 系統は体数グループごとに行を並べ直すので、せっかく
  // 発動特性数の順に並べても 11枠(15,14) → 10枠(14,13) → 11枠… と数字が上下してしまう。
  // ラダーで見たいのは「上から順にどれだけ特性を出せるか」そのものなので、
  // topN=0 で全行を flat に落とし、並べた順でそのまま描く。
  const trees = useMemo(
    () =>
      sections.map((s) => ({
        ...s,
        tree: buildTree(s.rows, units, emblems, traits, granters, ladderMode ? 0 : TOP_N),
      })),
    [sections, units, emblems, traits, granters, ladderMode],
  )

  // セクションごとのフルカード表示件数。選択・並び順・対象構成が変わったら先頭に戻す。
  // リセット用の useEffect を置くと1フレームだけ古い件数で描いてしまうので、
  // 基準キーを state に同梱して読み出し時に比較する。
  const pageKey = `${sel.join(',')}|${sortKey}|${bronzeMode}|${ladderMode}|${comps.length}`
  const [page, setPage] = useState<{ key: string; shown: Record<string, number> }>({
    key: pageKey,
    shown: {},
  })
  const shown = page.key === pageKey ? page.shown : {}

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
    // 下限を撤廃したので、ここに来るのは選択紋章を活用した試合が1件も無いときだけ。
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface/40 px-4 py-10 text-center text-sm text-muted">
        {t(lang, 'noComps')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1 text-xs font-medium text-faint">
        {t(lang, 'resultCount', { n: sorted.length })}
      </div>

      {trees.map(({ key, match, rows: sectionRows, tree }) => {
        // 「すべて使う構成」は稀少なので刻まずに全部出す（そこを探しに来ているセクションで
        // 「もっと見る」を挟むと、いちばん見たいものが隠れる）。長くなるのは単一選択の一覧と
        // 使う枚数が少ないセクションの方なので、そちらだけ PAGE_SIZE ずつ伸ばす。
        const paged = key !== 'full'
        const limit = paged ? (shown[key] ?? PAGE_SIZE) : tree.flat.length
        const visible = tree.flat.slice(0, limit)
        const remaining = tree.flat.length - visible.length

        return (
          <div key={key} className="flex flex-col gap-3">
            {key !== 'all' && (
              <div className="flex items-baseline gap-2 border-l-2 border-gold/50 pl-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">
                  {key === 'full'
                    ? t(lang, 'sectionFullUse', { n: sel.length })
                    : t(lang, 'sectionUseCount', { n: match })}
                </span>
                <span className="text-xs text-faint">{sectionRows.length}</span>
              </div>
            )}

            {/* 該当が1件も無いセクションは、見出しだけ残して理由を1行出す。畳んで消すと
                「出てこない」のか「無い」のか区別がつかず、今回の報告と同じ状態に戻る。 */}
            {key !== 'all' && sectionRows.length === 0 && (
              <div className="rounded-lg border border-dashed border-line bg-surface/40 px-3 py-3 text-xs text-muted">
                {key === 'full'
                  ? t(lang, 'noFullUse', { n: sel.length })
                  : t(lang, 'noUseCount', { n: match })}
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
                    dimLowSample={dimLowSample}
                    lang={lang}
                  />
                ))}
              </div>
            )}

            {/* 背骨が取れなかった行と、上位N件から外れた行。従来のフルカードで描く。 */}
            {visible.length > 0 && (
              <div className="flex flex-col gap-2">
                {tree.families.length > 0 && (
                  <div className="px-1 text-xs font-medium text-faint">
                    {t(lang, 'otherComps', { n: tree.flat.length })}
                  </div>
                )}
                {/* 同一盤面でも紋章の使われ方（row.used）が違えば別カード。キーに両方を含める。 */}
                {visible.map(({ comp, row, traitCount, bronze, active }) => (
                  <CompCard
                    key={`${comp.units.join(',')}|${row.used.join(',')}`}
                    stats={stats}
                    comp={comp}
                    row={row}
                    total={sel.length}
                    traitCount={traitCount}
                    bronze={bronze}
                    active={active}
                    cohort={cohort}
                    sortKey={sortKey}
                    lang={lang}
                    bronzeMode={bronzeMode}
                    ladderMode={ladderMode}
                    showUtilization={sel.length > 1}
                    dim={dimLowSample && row.n <= DIM_SAMPLE_MAX}
                  />
                ))}
              </div>
            )}

            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setPage({ key: pageKey, shown: { ...shown, [key]: limit + PAGE_SIZE } })}
                className="self-center rounded-md border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-line-strong hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
              >
                {t(lang, 'showMore', { n: Math.min(PAGE_SIZE, remaining), rest: remaining })}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}