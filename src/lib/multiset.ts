import type { CompStats } from '../../shared/types'

/**
 * sel の各値の出現回数が row 中の出現回数以下なら true（マルチセット部分集合）。
 * 空 sel は常に true。
 */
export function isMultisetSubset(sel: number[], row: number[]): boolean {
  if (sel.length === 0) return true
  const rowCounts = new Map<number, number>()
  for (const v of row) {
    rowCounts.set(v, (rowCounts.get(v) ?? 0) + 1)
  }
  const selCounts = new Map<number, number>()
  for (const v of sel) {
    selCounts.set(v, (selCounts.get(v) ?? 0) + 1)
  }
  for (const [v, count] of selCounts) {
    if ((rowCounts.get(v) ?? 0) < count) return false
  }
  return true
}

/**
 * comp.rows のうち isMultisetSubset(sel, row.e) を満たす行を合算する。
 * 空 sel の場合は全行が合算され、comp の n/top4/win と一致する。
 */
export function aggregateComp(
  comp: CompStats,
  sel: number[],
): { n: number; top4: number; win: number; p: number } {
  let n = 0
  let top4 = 0
  let win = 0
  let p = 0
  for (const row of comp.rows) {
    if (isMultisetSubset(sel, row.e)) {
      n += row.n
      top4 += row.top4
      win += row.win
      p += row.p
    }
  }
  return { n, top4, win, p }
}

/**
 * comp.rows のうち row.e が sel と1つでも交差する行（=選択紋章のいずれかを装備）を合算（OR集計）。
 * 空 sel の場合は全行を合算（aggregateComp と同じ）。単一選択なら subset と同結果。
 */
export function aggregateAny(
  comp: CompStats,
  sel: number[],
): { n: number; top4: number; win: number; p: number } {
  if (sel.length === 0) return aggregateComp(comp, sel)
  const selSet = new Set(sel)
  let n = 0
  let top4 = 0
  let win = 0
  let p = 0
  for (const row of comp.rows) {
    if (row.e.some((e) => selSet.has(e))) {
      n += row.n
      top4 += row.top4
      win += row.win
      p += row.p
    }
  }
  return { n, top4, win, p }
}

/** comp 内で、単一紋章 emblemIdx を装備していたゲーム数（その紋章を含む行のn合計）。 */
export function emblemGames(comp: CompStats, emblemIdx: number): number {
  let n = 0
  for (const row of comp.rows) if (row.e.includes(emblemIdx)) n += row.n
  return n
}
