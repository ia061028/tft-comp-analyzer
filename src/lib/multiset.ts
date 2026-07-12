import type { CompStats } from '../../shared/types'

export interface CompUsage {
  /** この行（＝この活用の仕方）の該当レコード数。 */
  adopt: number
  top4: number
  win: number
  /** 順位合計（平均順位 = p / adopt）。 */
  p: number
  /** 活用スコア X = Σ best。行内の全レコードで一定。 */
  x: number
  /** N = 選択紋章の総数（同一紋章の複数選択は加算）。 */
  n: number
  /** 紋章 → この行での活用スコア（0 .. その紋章の選択個数）。行内で一定。 */
  best: Map<number, number>
  /** 紋章 → 選択個数。 */
  req: Map<number, number>
  /** 行の識別キー（紋章スコアのベクトル）。同一構成の別行を区別する。 */
  key: string
}

function countOcc(arr: number[], e: number): number {
  let c = 0
  for (const x of arr) if (x === e) c++
  return c
}

/**
 * 構成 comp を、選択紋章 sel（マルチセット）の「活用の仕方」ごとの行に分解する。
 *
 * レコード群（sig）1つずつについて、選択紋章 e の活用スコアを
 *   score(e) = min(選択個数, one内のe数) + 0.5 * min(残り, half内のe数)
 * で求める（one=+1: 発動数がちょうどブレークポイント、half=+0.5: 発動しているが余りあり）。
 * 同じスコアベクトルを持つ sig をまとめて1行にし、その行の X = Σ score とする。
 *
 * 行に分けるのが要点。X を「紋章ごとに別々の sig から最良値を拾った合計」にすると、
 * A を使った試合群と B を使った試合群が別物でも X=2 になり、実在しない盤面を指す。
 * さらに X（最良値）と指標（該当 sig 全体のプール）で母数が食い違う。
 * 行に分ければ、バッジの X とその行の Top4率・平均順位の母数が必ず一致する。
 *
 * 選択紋章が1つも発動していない sig は対象外。該当行が無ければ空配列。返り値は X の降順。
 */
export function compUsages(comp: CompStats, sel: number[]): CompUsage[] {
  if (sel.length === 0) return []
  const req = new Map<number, number>()
  for (const e of sel) req.set(e, (req.get(e) ?? 0) + 1)
  const distinct = [...req.keys()].sort((a, b) => a - b)

  const rows = new Map<string, CompUsage>()
  for (const sig of comp.sigs) {
    const best = new Map<number, number>()
    let x = 0
    for (const e of distinct) {
      const m = req.get(e)!
      const filledOne = Math.min(m, countOcc(sig.one, e))
      const filledHalf = Math.min(m - filledOne, countOcc(sig.half, e))
      const score = filledOne + 0.5 * filledHalf
      best.set(e, score)
      x += score
    }
    if (x === 0) continue // 選択紋章がどれも発動していない sig

    // 合計 X が同じでも紋章の内訳が違えば別の構成（別の紋章を積んだ盤面）なので、
    // スコアのベクトルを行キーにする。
    const key = distinct.map((e) => `${e}:${best.get(e)}`).join(',')
    let row = rows.get(key)
    if (!row) {
      row = { adopt: 0, top4: 0, win: 0, p: 0, x, n: sel.length, best, req, key }
      rows.set(key, row)
    }
    row.adopt += sig.n
    row.top4 += sig.top4
    row.win += sig.win
    row.p += sig.p
  }
  return [...rows.values()].sort((a, b) => b.x - a.x)
}
