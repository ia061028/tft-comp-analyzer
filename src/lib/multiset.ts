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
  /**
   * この行のレコードのうち、選択紋章だけでは説明できない紋章（＝手持ち超過分）も
   * 活用していたレコード数。選択外の紋章、および「選択枚数を超える同一紋章」を含む。
   */
  extraAdopt: number
  /** 超過分の紋章 idx → それを活用していたレコード数（extraAdopt の内訳・降順表示用）。 */
  extra: Map<number, number>
}

export interface CompUsagesOptions {
  /**
   * 厳密モード: 選択紋章だけで達成したレコードに限定する（超過分の紋章を活用していた
   * レコードを除外）。「自分の手持ちだけでこの成績が出せるのか」を見るためのフィルタ。
   */
  strict?: boolean
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
export function compUsages(
  comp: CompStats,
  sel: number[],
  opts: CompUsagesOptions = {},
): CompUsage[] {
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

    // 手持ち超過分の紋章（選択外の紋章、および選択枚数を超える同一紋章）。
    // このレコードの成績は「あなたが持っていない紋章」にも支えられている、という情報。
    const surplus = new Set<number>()
    for (const e of new Set([...sig.one, ...sig.half])) {
      const used = countOcc(sig.one, e) + countOcc(sig.half, e)
      if (used > (req.get(e) ?? 0)) surplus.add(e)
    }
    if (opts.strict && surplus.size > 0) continue

    // 合計 X が同じでも紋章の内訳が違えば別の構成（別の紋章を積んだ盤面）なので、
    // スコアのベクトルを行キーにする。
    const key = distinct.map((e) => `${e}:${best.get(e)}`).join(',')
    let row = rows.get(key)
    if (!row) {
      row = {
        adopt: 0,
        top4: 0,
        win: 0,
        p: 0,
        x,
        n: sel.length,
        best,
        req,
        key,
        extraAdopt: 0,
        extra: new Map(),
      }
      rows.set(key, row)
    }
    row.adopt += sig.n
    row.top4 += sig.top4
    row.win += sig.win
    row.p += sig.p
    if (surplus.size > 0) {
      row.extraAdopt += sig.n
      for (const e of surplus) row.extra.set(e, (row.extra.get(e) ?? 0) + sig.n)
    }
  }
  return [...rows.values()].sort((a, b) => b.x - a.x)
}

/**
 * 紋章 idx → 1レコード内で同時に活用された最大枚数（データ上の上限）。
 * 未活用の紋章は 0。選択枚数がこれを超えると、その枚数を活かせる構成はデータに存在しない。
 */
export function maxEmblemMultiplicity(comps: CompStats[], emblemCount: number): number[] {
  const max = new Array<number>(emblemCount).fill(0)
  for (const comp of comps) {
    for (const sig of comp.sigs) {
      const used = new Map<number, number>()
      for (const e of sig.one) used.set(e, (used.get(e) ?? 0) + 1)
      for (const e of sig.half) used.set(e, (used.get(e) ?? 0) + 1)
      for (const [e, c] of used) if (e < emblemCount && c > max[e]) max[e] = c
    }
  }
  return max
}
