import type { CompStats } from '../../shared/types'

export interface CompUsage {
  /** 該当レコード数（選択紋章のいずれかが +1 のレコード）。 */
  adopt: number
  top4: number
  win: number
  /** 順位合計（平均順位 = p / adopt）。 */
  p: number
  /** 活用スコア X = Σ 各選択紋章の最良値（個数考慮）。 */
  x: number
  /** N = 選択紋章の総数（同一紋章の複数選択は加算）。 */
  n: number
  /** 紋章 → 最良スコア（0 .. その紋章の選択個数）。表示用。 */
  best: Map<number, number>
  /** 紋章 → 選択個数。 */
  req: Map<number, number>
}

function countOcc(arr: number[], e: number): number {
  let c = 0
  for (const x of arr) if (x === e) c++
  return c
}

/**
 * 構成 comp に対する、選択紋章 sel（マルチセット）の活用状況。
 * - 「選択紋章のいずれかが +1」のシグネチャ行のみを該当として集計。
 * - 各紋章 e の score = 該当 sig ごとに min(個数, one内のe数) + 0.5*min(残り, half内のe数) の最大値。
 * - X = Σ score、N = sel.length（同一紋章の複数選択を加算）。
 * - 該当行が1つも無ければ null。
 */
export function compUsage(comp: CompStats, sel: number[]): CompUsage | null {
  if (sel.length === 0) return null
  const req = new Map<number, number>()
  for (const e of sel) req.set(e, (req.get(e) ?? 0) + 1)
  const distinct = [...req.keys()]
  const distinctSet = new Set(distinct)

  let adopt = 0
  let top4 = 0
  let win = 0
  let p = 0
  const best = new Map<number, number>()
  for (const e of distinct) best.set(e, 0)

  let any = false
  for (const sig of comp.sigs) {
    if (!sig.one.some((e) => distinctSet.has(e))) continue
    any = true
    adopt += sig.n
    top4 += sig.top4
    win += sig.win
    p += sig.p
    for (const e of distinct) {
      const m = req.get(e)!
      const filledOne = Math.min(m, countOcc(sig.one, e))
      const filledHalf = Math.min(m - filledOne, countOcc(sig.half, e))
      const score = filledOne + 0.5 * filledHalf
      if (score > (best.get(e) ?? 0)) best.set(e, score)
    }
  }
  if (!any) return null

  let x = 0
  for (const v of best.values()) x += v
  return { adopt, top4, win, p, x, n: sel.length, best, req }
}
