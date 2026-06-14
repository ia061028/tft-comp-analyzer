import type { CompStats } from '../../shared/types'

/**
 * comp.rows のうち row.e が sel と1つでも交差する行（=選択紋章のいずれかを装備）を合算（OR集計）。
 * 空 sel の場合は全行を合算（comp 全体）。
 */
export function aggregateAny(
  comp: CompStats,
  sel: number[],
): { n: number; top4: number; win: number; p: number } {
  const selSet = sel.length > 0 ? new Set(sel) : null
  let n = 0
  let top4 = 0
  let win = 0
  let p = 0
  for (const row of comp.rows) {
    if (selSet === null || row.e.some((e) => selSet.has(e))) {
      n += row.n
      top4 += row.top4
      win += row.win
      p += row.p
    }
  }
  return { n, top4, win, p }
}

/** comp 内で単一紋章 emblemIdx を装備していたゲーム数（その紋章を含む行の n 合計）。 */
export function emblemGames(comp: CompStats, emblemIdx: number): number {
  let n = 0
  for (const row of comp.rows) if (row.e.includes(emblemIdx)) n += row.n
  return n
}
