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

/**
 * 「同時装着」ベースの集計。選択紋章のうち実際に同じゲームで一緒に装着された
 * 最大数（usedCount=最大重なり深さ）を求め、その深さを達成した行（=実際に活用した
 * ゲーム）のみで成績を合算する。
 *
 * - K=1: その紋章を含む行で集計（従来 emblemGames と同等の母数）。
 * - K=2 で同時装着あり: [A,B] を含む行のみで集計、usedCount=2。
 * - K=2 で別々のみ: A単独∪B単独の行で集計、usedCount=1。
 * - 該当行なし: usedCount=0, 全0。
 */
export function aggregateUtilized(
  comp: CompStats,
  sel: number[],
): { usedCount: number; n: number; top4: number; win: number; p: number } {
  const selSet = new Set(sel)
  if (selSet.size === 0) {
    // 選択なし: 構成全体を集計（理論上 UI からは呼ばれない）。
    let n = 0
    let top4 = 0
    let win = 0
    let p = 0
    for (const row of comp.rows) {
      n += row.n
      top4 += row.top4
      win += row.win
      p += row.p
    }
    return { usedCount: 0, n, top4, win, p }
  }

  // その行に含まれる「選択紋章の異なり数」。同じ紋章を複数装着していても
  // 1 種としてのみ数える（例: ブローラー紋章×2 でも overlap=1）。
  const overlap = (row: { e: number[] }): number => {
    let o = 0
    for (const e of selSet) if (row.e.includes(e)) o++
    return o
  }

  let usedCount = 0
  for (const row of comp.rows) {
    const o = overlap(row)
    if (o > usedCount) usedCount = o
  }

  let n = 0
  let top4 = 0
  let win = 0
  let p = 0
  if (usedCount > 0) {
    for (const row of comp.rows) {
      if (overlap(row) === usedCount) {
        n += row.n
        top4 += row.top4
        win += row.win
        p += row.p
      }
    }
  }
  return { usedCount, n, top4, win, p }
}
