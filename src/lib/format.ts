// 構成カードの見た目に関する純粋なヘルパ群（配色・ティア判定・チームコード生成）。
// CompList/CompCard から共有する。

import type { UnitInfo } from '../../shared/types'

/** style 値 → バッジ配色（3=ゴールド系, 4=プリズム系, 1-2は銅/銀） */
export function styleClasses(style: number): string {
  switch (style) {
    case 4:
      return 'border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-200'
    case 3:
      return 'border-amber-400/60 bg-amber-400/10 text-amber-200'
    case 2:
      return 'border-zinc-300/50 bg-zinc-300/10 text-zinc-100'
    default:
      return 'border-orange-700/60 bg-orange-700/10 text-orange-300'
  }
}

/** スターレベル → ★の配色（3=金,2=銀,1=銅） */
export function starColor(star: number): string {
  switch (star) {
    case 3:
      return 'text-amber-300'
    case 2:
      return 'text-zinc-200'
    default:
      return 'text-orange-400'
  }
}

/** コスト → ユニットアイコン枠の配色（1=グレー,2=緑,3=青,4=紫,5=金） */
export function costBorder(cost: number): string {
  switch (cost) {
    case 5:
      return 'border-amber-400'
    case 4:
      return 'border-purple-400'
    case 3:
      return 'border-sky-400'
    case 2:
      return 'border-green-400'
    default:
      return 'border-zinc-500'
  }
}

/**
 * 平均順位 → ティア。しきい値は現行データの分布（中央値≈4.3, p10≈3.3, p90≈5.7）に
 * 合わせて各ティアが偏らないよう設定。配色はグラデーションでモダンに。
 */
export function tierOf(avgPlace: number): { label: string; classes: string } {
  if (avgPlace <= 3.5)
    return { label: 'S', classes: 'bg-gradient-to-br from-amber-300 to-amber-500 text-zinc-950' }
  if (avgPlace <= 4.0)
    return { label: 'A', classes: 'bg-gradient-to-br from-fuchsia-400 to-fuchsia-600 text-zinc-950' }
  if (avgPlace <= 4.5)
    return { label: 'B', classes: 'bg-gradient-to-br from-sky-400 to-sky-600 text-zinc-950' }
  if (avgPlace <= 5.2)
    return { label: 'C', classes: 'bg-gradient-to-br from-green-400 to-green-600 text-zinc-950' }
  return { label: 'D', classes: 'bg-gradient-to-br from-zinc-600 to-zinc-700 text-zinc-100' }
}

/**
 * チームプランナーの貼付コード（現行 02 形式）:
 * `02` + 10スロット×「team_planner_code を12bit=3桁hex(big-endian)」 + `TFTSet{N}`。空き枠は `000`。
 * （旧 01 形式は8bit/2桁だが、グローバルIDが255を超えるため12bit形式に変更されている）
 */
export function buildPlannerCode(unitIdxs: number[], units: UnitInfo[], setNumber: number): string {
  const slots: string[] = []
  for (const idx of unitIdxs) {
    const code = units[idx]?.code ?? 0
    if (code > 0) slots.push(code.toString(16).padStart(3, '0'))
  }
  while (slots.length < 10) slots.push('000')
  return '02' + slots.slice(0, 10).join('') + 'TFTSet' + setNumber
}
