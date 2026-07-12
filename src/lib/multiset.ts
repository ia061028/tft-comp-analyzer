import type { CompStats } from '../../shared/types'

/**
 * 構成一覧の1行 ＝ 1つの盤面 × 1つの紋章構成（レコードのシグネチャそのもの）。
 *
 * 表示するのは「選択紋章だけで再現できるレコード」に限る。手持ち外の紋章を使っていた
 * レコードは、そもそもあなたには作れない盤面なので母数から外す。
 * これにより、カードに出る紋章・特性・成績がすべて同じレコード集合を指す。
 */
export interface CompRow {
  /** この行で活用された紋章の多重集合（昇順）。選択紋章の部分多重集合であることが保証される。 */
  used: number[]
  /** 一致数 = used.length。選択紋章のうち何枚を活かせているか。 */
  match: number
  /** 該当レコード数。 */
  n: number
  top4: number
  win: number
  /** 順位合計（平均順位 = p / n）。 */
  p: number
}

/** 多重集合の包含判定: a のすべての要素が b に足りているか（a・b は昇順ソート済み）。 */
function isSubset(a: number[], b: number[]): boolean {
  let j = 0
  for (const x of a) {
    while (j < b.length && b[j] < x) j++
    if (j >= b.length || b[j] !== x) return false
    j++
  }
  return true
}

/**
 * 構成 comp のうち、選択紋章 sel（多重集合）だけで再現できるレコード群を行として返す。
 *
 * 各シグネチャ（＝その試合で活用された紋章の多重集合）が sel の部分多重集合なら採用。
 * 選択外の紋章を使っていた試合、および選択枚数を超えて同一紋章を使っていた試合は除外する
 * （あなたの手持ちでは作れないため。実データではそれらの試合は平均順位が 0.35 位ぶん良く、
 * 混ぜると成績が水増しされる）。
 *
 * シグネチャがそのまま行になるので、行の集約は不要。返り値は一致数の降順。
 */
export function compRows(comp: CompStats, sel: number[]): CompRow[] {
  if (sel.length === 0) return []
  const have = sel.slice().sort((a, b) => a - b)

  const rows: CompRow[] = []
  for (const sig of comp.sigs) {
    if (!isSubset(sig.e, have)) continue
    rows.push({
      used: sig.e,
      match: sig.e.length,
      n: sig.n,
      top4: sig.top4,
      win: sig.win,
      p: sig.p,
    })
  }
  return rows.sort((a, b) => b.match - a.match)
}

/**
 * 紋章 idx → 1レコード内で同時に活用された最大枚数（データ上の上限）。
 * 未活用の紋章は 0。選択枚数がこれを超えると、その枚数を活かせる構成はデータに存在しない。
 */
export function maxEmblemMultiplicity(comps: CompStats[], emblemCount: number): number[] {
  const max = new Array<number>(emblemCount).fill(0)
  for (const comp of comps) {
    for (const sig of comp.sigs) {
      // sig.e は昇順なので、同じ値の連続長がその紋章の枚数。
      let i = 0
      while (i < sig.e.length) {
        const e = sig.e[i]
        let c = 0
        while (i < sig.e.length && sig.e[i] === e) {
          c++
          i++
        }
        if (e < emblemCount && c > max[e]) max[e] = c
      }
    }
  }
  return max
}
