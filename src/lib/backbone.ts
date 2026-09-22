// 構成一覧を「背骨（コア）＋派生」のツリーに畳む。
//
// 一覧の上位はほぼ同じ構成（同じキャリー、違うのは1〜2体）なのに、全構成が独立にフル描画される。
// 「どれを作るか」は差の比較なのに、差がどこにも表現されていない。
//
// 背骨（＝系統の大半に共通するユニット）を1回だけ描けば、各派生は「+1〜2体」だけになる。
// さらに派生を**盤面ユニット数でグループ化**すると、生存バイアスが構造的に相殺される:
// 平均順位は実質ユニット数を測っている（7体=5.60 … 10体=1.95）ので、
// 8体 → 9体 を「改善」として見せてはいけない（9体まで生き残れた人の成績なだけ）。
// **比較可能なのは同じ体数の兄弟だけ。**

import type { CompStats, EmblemInfo, TraitGranter, TraitInfo, UnitInfo } from '../../shared/types'
import type { CompRow } from './multiset'
import {
  appliedGrants,
  activeTier,
  activeTraitCounts,
  activeTraitTotal,
  bronzeTraitCount,
  effectiveUnits,
  grantsByUnit,
  holderMap,
} from './format'

/**
 * ツリー化の対象は上位N行だけ。全行だと系統が40個に割れ、クラスタリングも 600ms 超で実用外。
 *
 * 20 では紋章1枚の一覧 962 行のうち系統に入るのが 15 行しかなく、残り 947 行はフラットカードに
 * 落ちていた。実測（人気上位5紋章）でツリー化率は N を広げても 88〜90% で一定、クラスタリングは
 * N=60 で最悪 7.8ms（N=120 で 35ms、160 で 75ms）。3倍の行を系統に載せても一覧が長くなりすぎない
 * ところとして 60 を取る。
 */
export const TOP_N = 60
/** 完全連結クラスタリングのカット高さ（Jaccard 距離）。実測でツリー化率が最大になる値。 */
export const CUT = 0.4
/** 背骨がこれ未満の系統は、差分表示がフル盤面より読みにくくなるのでフラット縮退。 */
export const MIN_BACKBONE = 6
/** 差分（追加＋欠落）がこれを超える行は、背骨からの派生として読めないのでフラット縮退。 */
export const MAX_DIFF = 3
/** 1行だけの系統は「背骨＋派生ゼロ」になり意味がないのでフラット縮退。 */
export const MIN_FAMILY = 2
/** 系統のこの割合以上の行に出るユニットを背骨とする。 */
export const BACKBONE_RATIO = 0.7

/** CompList が作る1行。ツリーもフォールバックもこの単位で扱う。 */
export interface Row {
  comp: CompStats
  row: CompRow
  traitCount: Map<number, number>
  bronze: number
  /** 発動している特性の種類数（固有特性込み）。特性ラダー順の並べ替えと表示で使う。 */
  active: number
}

/** 背骨からの派生1件。 */
export interface Deriv extends Row {
  /** 背骨に無いユニット（＝この派生で足す駒）。 */
  adds: number[]
  /** 背骨にあるが、この盤面には居ないユニット（＝欠落）。 */
  removes: number[]
  /**
   * コアから**発動段が上がる／新たに発動する**特性。[traitIdx, style, 発動段]。
   * 「この駒を足すと何が伸びるのか」＝派生を選ぶ理由そのもの。
   */
  synergy: [number, number, number][]
  /** sorted 内での順位（0 が最良）。系統の並び順に使う。 */
  rank: number
  /**
   * 体数グループの列ごとに、この盤面が置く unitIdx。空きマスは -1。
   * 長さは `UnitGroup.lanes` と同じ。グループ分けのあとに `buildGroupLanes` が入れる。
   */
  slots: number[]
}

/** 最小・中央値・最大。「だいたいどのくらいか」を1行で示すための要約。 */
export interface Span {
  min: number
  median: number
  max: number
}

/**
 * 同じ盤面ユニット数の派生の束。**比較が正当なのはこの中だけ。**
 *
 * 統計サマリ（place/top4/win）は**このグループの中だけ**で集計する。系統全体で集計すると
 * 7体〜10体が混ざり、平均順位の幅（例 1.83〜6.74）が構成の差ではなく生存バイアスそのものになる。
 */
export interface UnitGroup {
  units: number
  derivs: Deriv[]
  /** 平均順位（小さいほど良い）。 */
  place: Span
  /** Top4率 %。 */
  top4: Span
  /** 1位率 %。 */
  win: Span
  /**
   * このグループの列。長さは体数とほぼ同じで、系統ぜんぶの和集合にはしない。
   * 共通駒が左に固定で並び、残りは右に詰まる。
   */
  lanes: GroupLane[]
}

/**
 * 系統の「列」。1列＝1ユニットで、系統のどの体数グループでも同じ横位置に来る。
 *
 * 派生ごとに盤面を素直に並べると、同じ駒が行ごとに違う位置に出る。読み手は毎行アイコンを
 * 見比べて共通部分を組み直すことになり、それがゲーム中の瞬間判断をいちばん妨げる。
 * 列を固定すれば共通駒は縦にそろい、目が動くのは「選ぶ枠」だけになる。
 */
export interface Lane {
  unitIdx: number
  /** このユニットが固定枠（＝その体数グループの全派生に出る）になっているグループ数。 */
  fixedIn: number
  /** このユニットが現れる体数グループ数。 */
  inGroups: number
}

/** 体数グループの列1本。 */
export interface GroupLane {
  /**
   * 全派生に同じ駒が入る列なら、その unitIdx。派生ごとに中身が変わる列（＝選ぶ枠）なら null。
   * 選ぶ枠は複数のユニットで共有するので、どの駒かは派生の `slots` が持つ。
   */
  fixed: number | null
}

export interface Family {
  /** コアユニット（表示順）。 */
  backbone: number[]
  /** コア側の装備者: unitIdx → emblemIdx[]。系統の最良行のものを使う。 */
  holders: Map<number, number[]>
  /** **コアだけ**で発動している特性（コアユニット ＋ 活用紋章）。派生のシナジー差分の基準。 */
  traitCount: Map<number, number>
  /** 最良行が使っている紋章の多重集合（特性チップの「紋章由来」判定に使う）。 */
  used: number[]
  /**
   * 系統内で「使う紋章」が派生ごとに違うか。
   *
   * 同じ盤面でも紋章の使い方（1枚だけ使う / 2枚とも使う）が違えば別の行になる。
   * 差分（追加・欠落）が同じだと画面上まったく同じ行に見えてしまうので、
   * このときは派生ごとに使用紋章を出して区別する。
   */
  mixedEmblems: boolean
  /** 盤面ユニット数の降順。 */
  groups: UnitGroup[]
  /**
   * 系統ぜんぶで見たユニットの序列。列そのものは体数グループごとに組む（`UnitGroup.lanes`）が、
   * 並べる順番はここで一度決めるので、体数が違っても共通駒の相対順が変わらない。
   */
  lanes: Lane[]
  /** この系統の派生総数。 */
  total: number
  /** 最良の派生の順位（0 が最良）。系統の並び順に使う。 */
  rank: number
}

export interface Tree {
  families: Family[]
  /** ツリーに載らなかった行（従来のフラットカードで描く）。 */
  flat: Row[]
}

/** 盤面の Jaccard 距離。0 = 同一、1 = 共通ユニットなし。 */
function jaccard(a: number[], aSet: Set<number>, b: number[]): number {
  let inter = 0
  for (const u of b) if (aSet.has(u)) inter++
  const union = a.length + b.length - inter
  return union === 0 ? 0 : 1 - inter / union
}

/**
 * 完全連結の凝集型クラスタリング。返すのは rows のインデックス配列。
 *
 * **単連結（＝「種との重なりが閾値以上なら同じ束」という貪欲法）では連鎖崩壊する** —
 * A≈B, B≈C だが A≉C でも全部1束になり、共通部分が消える。実測で139行中85行が1束になり、
 * コアが1体に潰れた。クラスタ内の**全ペア**が cut 以内であることを要求すれば、
 * 共通部分（＝背骨）が必ず残る。
 *
 * 入力は TOP_N 行なので O(n^3) でも実測 ~2ms。
 */
function completeLinkage(rows: Row[], cut: number): number[][] {
  const sets = rows.map((r) => new Set(r.comp.units))
  const d: number[][] = rows.map((a, i) =>
    rows.map((b, j) => (i === j ? 0 : jaccard(a.comp.units, sets[i], b.comp.units))),
  )

  const clusters = rows.map((_, i) => [i])
  for (;;) {
    let bestI = -1
    let bestJ = -1
    let best = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // 完全連結: クラスタ間距離 = 全ペアの最大距離
        let far = 0
        for (const a of clusters[i]) for (const b of clusters[j]) if (d[a][b] > far) far = d[a][b]
        if (far < best) {
          best = far
          bestI = i
          bestJ = j
        }
      }
    }
    if (bestI < 0 || best > cut) break
    clusters[bestI] = clusters[bestI].concat(clusters[bestJ])
    clusters.splice(bestJ, 1)
  }
  // 各クラスタ内・クラスタ間ともに、最良行（＝小さいインデックス）が先に来るようにする。
  for (const c of clusters) c.sort((a, b) => a - b)
  clusters.sort((a, b) => a[0] - b[0])
  return clusters
}

/** 系統の BACKBONE_RATIO 以上の行に出るユニット。出現数の多い順（同数は unitIdx 昇順）で安定化。 */
function backboneOf(members: Row[]): number[] {
  const freq = new Map<number, number>()
  for (const m of members) {
    for (const u of new Set(m.comp.units)) freq.set(u, (freq.get(u) ?? 0) + 1)
  }
  const need = members.length * BACKBONE_RATIO
  return [...freq]
    .filter(([, c]) => c >= need)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([u]) => u)
}

/** 昇順ソートした配列の中央値（偶数個は中央2つの平均）。 */
function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function spanOf(xs: number[]): Span {
  return { min: Math.min(...xs), median: median(xs), max: Math.max(...xs) }
}

/**
 * コアだけで発動している特性（コアユニットの所持特性 ＋ 活用紋章の付与分 ＋ 上乗せ特性）。
 * 派生の「伸びる特性」は、これを基準にした差分として出す。
 *
 * 上乗せ（ラックスの選択特性等）は**付与元がコアに居るぶんだけ**足す。ここで足さないと、
 * コアにも派生にも同じ駒が居るのに派生側だけ数が増え、「この駒を足すと伸びる」に
 * 出てはいけない特性が出る。
 */
function coreTraitCounts(
  backbone: number[],
  best: Row,
  units: UnitInfo[],
  emblems: EmblemInfo[],
  granters: TraitGranter[],
): Map<number, number> {
  const counts = new Map<number, number>()
  for (const ui of backbone) {
    for (const ti of units[ui]?.traits ?? []) counts.set(ti, (counts.get(ti) ?? 0) + 1)
  }
  for (const ei of best.row.used) {
    const ti = emblems[ei]?.trait
    if (ti == null) continue
    counts.set(ti, (counts.get(ti) ?? 0) + 1)
  }
  const bset = new Set(backbone)
  const applied = new Set(appliedGrants(best.comp, granters))
  for (const [ui, grants] of grantsByUnit(best.comp, granters)) {
    if (!bset.has(ui)) continue
    for (const g of grants) {
      if (!applied.has(g)) continue
      counts.set(g.trait, (counts.get(g.trait) ?? 0) + g.delta)
    }
  }
  return counts
}

/**
 * この派生でコアから**発動段が上がる／新たに発動する**特性。
 * 「この駒を足すと何が伸びるのか」＝派生を選ぶ理由。発動段の高い順。
 */
function synergyGain(
  derivCounts: Map<number, number>,
  coreCounts: Map<number, number>,
  traits: TraitInfo[],
): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const [ti, n] of derivCounts) {
    const tr = traits[ti]
    if (!tr) continue
    const now = activeTier(n, tr.tiers)
    if (!now) continue
    const before = activeTier(coreCounts.get(ti) ?? 0, tr.tiers)
    if (before && before.min >= now.min) continue // 段が上がっていない
    out.push([ti, now.style, now.min])
  }
  return out.sort((a, b) => b[1] - a[1] || b[2] - a[2])
}

/**
 * 系統ぜんぶで見たユニットの序列を決める。
 *
 * 並びは「どの体数グループでも固定の駒 → 出てくるグループが多い駒 → 高コスト」。
 * 実際の列はこの順を土台に体数グループごとに組む（`buildGroupLanes`）が、順番を系統で
 * 一度だけ決めておくことで、8体と9体で共通駒の相対順が入れ替わらない。
 */
function buildLanes(groups: UnitGroup[], units: UnitInfo[]): Lane[] {
  // グループごとに「そのユニットが何派生に出るか」を数える。
  const counts = groups.map((g) => {
    const m = new Map<number, number>()
    for (const d of g.derivs) for (const u of new Set(d.comp.units)) m.set(u, (m.get(u) ?? 0) + 1)
    return m
  })

  const byUnit = new Map<number, Lane>()
  groups.forEach((g, gi) => {
    for (const [u, c] of counts[gi]) {
      const lane = byUnit.get(u) ?? { unitIdx: u, fixedIn: 0, inGroups: 0 }
      lane.inGroups += 1
      if (c === g.derivs.length) lane.fixedIn += 1
      byUnit.set(u, lane)
    }
  })

  return [...byUnit.values()].sort(
    (a, b) =>
      b.fixedIn - a.fixedIn ||
      b.inGroups - a.inGroups ||
      (units[b.unitIdx]?.cost ?? 0) - (units[a.unitIdx]?.cost ?? 0) ||
      a.unitIdx - b.unitIdx,
  )
}

/**
 * 1つの体数グループの列を組み、各派生の `slots` を埋める。
 *
 * **系統ぜんぶの和集合を列にしない。** 和集合だと 8体の構成が 21 列に薄く散り、
 * どの行も大半が空きマスになって、かえって盤面が読めなくなる。列はこのグループの
 * 体数ぶんに詰める。
 *
 * 1. **全派生に出る駒＝共通駒**を左から固定で並べる。並べ方は系統の序列どおりなので、
 *    どの派生も同じ横位置に同じ駒が来て、共通であることが並びだけで分かる。
 * 2. 残りの駒は右側の列を共有する。同じ派生に同居する駒どうしだけ別の列に分ければよい
 *    （＝共起グラフの彩色）ので、出現派生数の多い駒から順に、置ける一番左の列へ入れる。
 *    A,B,C と A,B,D なら A・B はそろい、C と D は同居しないので同じ列に詰まる。
 *
 * 列数の下限は1派生が置く駒の数そのもの（どの派生も同時にそれだけの列を使うため）で、
 * 貪欲法がそれを超えるのは駒の重なり方が悪いときだけ。空きマスは選ぶ枠にしか出ない。
 * グループのキー（`units`）は実効の盤面サイズなので、1駒で2枠を取る駒が居ると列数より多い。
 */
function buildGroupLanes(g: UnitGroup, order: Map<number, number>): GroupLane[] {
  const rank = (u: number) => order.get(u) ?? Number.MAX_SAFE_INTEGER
  const sets = g.derivs.map((d) => new Set(d.comp.units))

  const counts = new Map<number, number>()
  for (const set of sets) for (const u of set) counts.set(u, (counts.get(u) ?? 0) + 1)

  const common: number[] = []
  const rest: number[] = []
  for (const [u, c] of counts) (c === g.derivs.length ? common : rest).push(u)
  common.sort((a, b) => rank(a) - rank(b))
  rest.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || rank(a) - rank(b))

  const lanes: GroupLane[] = common.map((u) => ({ fixed: u }))
  const slots = g.derivs.map(() => common.slice())

  // 選ぶ枠。派生ごとに「その列はもう埋まっているか」を見ながら、置ける一番左へ。
  for (const u of rest) {
    const inDerivs = sets.map((set, i) => (set.has(u) ? i : -1)).filter((i) => i >= 0)
    let col = common.length
    for (; ; col++) {
      if (inDerivs.every((i) => (slots[i][col] ?? -1) < 0)) break
    }
    if (col >= lanes.length) {
      for (let c = lanes.length; c <= col; c++) lanes.push({ fixed: null })
    }
    for (const i of inDerivs) {
      for (let c = slots[i].length; c < col; c++) slots[i].push(-1)
      slots[i][col] = u
    }
  }

  for (let i = 0; i < g.derivs.length; i++) {
    for (let c = slots[i].length; c < lanes.length; c++) slots[i].push(-1)
    g.derivs[i].slots = slots[i]
  }
  return lanes
}

/**
 * 上位 TOP_N 行を系統に分け、系統ごとにコアと派生（体数グループ）を作る。
 * コアが取れない系統・差分が大きすぎる行・1行だけの系統は flat に落とす（ツリーを強制しない）。
 *
 * sorted は CompList が並べ替え済みの全行。先頭が最良。
 */
export function buildTree(
  sorted: Row[],
  units: UnitInfo[] = [],
  emblems: EmblemInfo[] = [],
  traits: TraitInfo[] = [],
  granters: TraitGranter[] = [],
  topN: number = TOP_N,
): Tree {
  const head = sorted.slice(0, topN)
  if (head.length < MIN_FAMILY) return { families: [], flat: sorted }

  const families: Family[] = []
  // flat は「元の並び順」を保ちたいので、まず rank を集めてから最後に並べ替える。
  const flatRanks: number[] = []

  for (const idxs of completeLinkage(head, CUT)) {
    const members = idxs.map((i) => head[i])
    if (members.length < MIN_FAMILY) {
      flatRanks.push(...idxs)
      continue
    }
    const backbone = backboneOf(members)
    if (backbone.length < MIN_BACKBONE) {
      flatRanks.push(...idxs)
      continue
    }
    const bset = new Set(backbone)

    // コアだけの発動特性。系統の最良行が使う紋章を前提にする（紋章は系統内で共通）。
    const coreCounts = coreTraitCounts(backbone, members[0], units, emblems, granters)

    const derivs: Deriv[] = []
    const dropped: number[] = []
    for (let k = 0; k < members.length; k++) {
      const m = members[k]
      const board = new Set(m.comp.units)
      const adds = m.comp.units.filter((u) => !bset.has(u))
      const removes = backbone.filter((u) => !board.has(u))
      if (adds.length + removes.length > MAX_DIFF) {
        dropped.push(idxs[k]) // この行だけ縮退。同じ系統の他の行はツリーに残す。
        continue
      }
      derivs.push({
        ...m,
        adds,
        removes,
        synergy: synergyGain(m.traitCount, coreCounts, traits),
        rank: idxs[k],
        slots: [],
      })
    }
    // 差分の大きい行を落とした結果、派生が1件以下になったら系統として成立しない。
    if (derivs.length < MIN_FAMILY) {
      flatRanks.push(...idxs)
      continue
    }
    flatRanks.push(...dropped)

    // 体数でグループ化（降順）。グループ内は sorted の順（＝選んだ指標の順）を保つ。
    //
    // 統計サマリはこのグループの中だけで集計する。系統全体で集計すると 7体〜10体が混ざり、
    // 平均順位の幅が「構成の差」ではなく生存バイアスそのものになってしまう。
    const byUnits = new Map<number, Deriv[]>()
    for (const d of derivs) {
      const k = effectiveUnits(d.comp)
      if (!byUnits.has(k)) byUnits.set(k, [])
      byUnits.get(k)!.push(d)
    }
    const groups: UnitGroup[] = [...byUnits]
      .sort((a, b) => b[0] - a[0])
      .map(([unitCount, ds]) => ({
        units: unitCount,
        derivs: ds,
        place: spanOf(ds.map((d) => d.row.p / d.row.n)),
        top4: spanOf(ds.map((d) => (d.row.top4 / d.row.n) * 100)),
        win: spanOf(ds.map((d) => (d.row.win / d.row.n) * 100)),
        lanes: [],
      }))

    const lanes = buildLanes(groups, units)
    const order = new Map(lanes.map((l, i) => [l.unitIdx, i]))
    for (const g of groups) g.lanes = buildGroupLanes(g, order)

    // コアの装備者は系統の最良行のものを使う（derivs は rank 昇順なので先頭が最良）。
    const best = derivs[0]
    const bestKey = best.row.used.join(',')
    families.push({
      backbone,
      holders: holderMap(best.comp, best.row.used),
      traitCount: coreCounts,
      used: best.row.used,
      mixedEmblems: derivs.some((d) => d.row.used.join(',') !== bestKey),
      groups,
      lanes,
      total: derivs.length,
      rank: best.rank,
    })
  }

  // 系統は「最良の派生」が良い順。
  families.sort((a, b) => a.rank - b.rank)
  flatRanks.sort((a, b) => a - b)

  return {
    families,
    flat: [...flatRanks.map((i) => head[i]), ...sorted.slice(topN)],
  }
}

/** 行を作る（CompList と backbone.test で共有）。 */
export function makeRow(
  comp: CompStats,
  row: CompRow,
  units: UnitInfo[],
  emblems: EmblemInfo[],
  traits: TraitInfo[],
  granters: TraitGranter[] = [],
): Row {
  const traitCount = activeTraitCounts(comp, row.used, units, emblems, granters)
  return {
    comp,
    row,
    traitCount,
    bronze: bronzeTraitCount(traitCount, traits),
    active: activeTraitTotal(traitCount, traits),
  }
}
