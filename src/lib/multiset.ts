import type { CompStats } from '../../shared/types'

/**
 * 構成一覧の1行。
 *
 * 1つの構成（＝盤面ユニット集合）は「選択紋章のうち実際に使われた組み合わせ」ごとに
 * 複数の行へ分解される。こうすると、行に表示する一致数と、Top4率・平均順位の母数が
 * 必ず同じレコード集合を指す（片方が最良値、片方が全体のプール、という食い違いが起きない）。
 */
export interface CompRow {
  /** この行で実際に使われた「あなたの紋章」の多重集合（昇順）。行内の全レコードで一定。 */
  used: number[]
  /** 一致数 = used.length。整数のみ（紋章の余りは区別しない）。 */
  match: number
  /** 該当レコード数。 */
  n: number
  top4: number
  win: number
  /** 順位合計（平均順位 = p / n）。 */
  p: number
  /** 手持ち外の紋章 idx → それを活用していたレコード数。 */
  extra: Map<number, number>
  /** 手持ち外の紋章を活用していたレコード数の合計。 */
  extraN: number
}

/** 多重集合の交差 a ∩ b（a・b は昇順ソート済み）。 */
function intersect(a: number[], b: number[]): number[] {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i])
      i++
      j++
    } else if (a[i] < b[j]) i++
    else j++
  }
  return out
}

/** 多重集合の差 a − b（a・b は昇順ソート済み）。b に無い/足りない分だけ残る。 */
function difference(a: number[], b: number[]): number[] {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length) {
    if (j >= b.length || a[i] < b[j]) out.push(a[i++])
    else if (a[i] === b[j]) {
      i++
      j++
    } else j++
  }
  return out
}

/**
 * 構成 comp を、選択紋章 sel（多重集合）の「使われ方」ごとの行に分解する。
 *
 * - マッチ: そのレコードが選択紋章を1つ以上活用している（交差が非空）
 * - 一致数: 交差の要素数。同一紋章の複数選択も多重集合として正しく数える
 * - 手持ち外: レコードが活用した紋章 − 選択（選択外の紋章、および選択枚数を超える同一紋章）
 * - strict: 手持ち外を含むレコードを母数から除外する（自分の紋章だけで達成した試合に限定）
 *
 * 返り値は一致数の降順。該当行が無ければ空配列。
 */
export function compRows(comp: CompStats, sel: number[], strict = false): CompRow[] {
  if (sel.length === 0) return []
  const want = sel.slice().sort((a, b) => a - b)

  const rows = new Map<string, CompRow>()
  for (const sig of comp.sigs) {
    const used = intersect(sig.e, want)
    if (used.length === 0) continue // 選択紋章をどれも活用していない
    const extra = difference(sig.e, want)
    if (strict && extra.length > 0) continue

    const key = used.join(',')
    let row = rows.get(key)
    if (!row) {
      row = { used, match: used.length, n: 0, top4: 0, win: 0, p: 0, extra: new Map(), extraN: 0 }
      rows.set(key, row)
    }
    row.n += sig.n
    row.top4 += sig.top4
    row.win += sig.win
    row.p += sig.p
    if (extra.length > 0) {
      row.extraN += sig.n
      // 同一紋章が複数余っていても「その紋章を併用したレコード数」は1回だけ数える。
      for (const e of new Set(extra)) row.extra.set(e, (row.extra.get(e) ?? 0) + sig.n)
    }
  }
  return [...rows.values()].sort((a, b) => b.match - a.match)
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
