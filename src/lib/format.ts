// 構成カードの見た目に関する純粋なヘルパ群（配色・ティア判定・チームコード生成）。
// CompList/CompCard から共有する。

import type { UnitInfo } from '../../shared/types'

/**
 * CDragon の trait effect style 値 → バッジ配色。
 * MetaTFT風のフラットで視認性の高い配色に変更。
 */
export function styleClasses(style: number): string {
  if (style >= 6) return 'border-[#f085ba] bg-[#f085ba]/20 text-[#fbd7e9]' // Prismatic
  if (style >= 5) return 'border-[#f2b968] bg-[#f2b968]/20 text-[#fbe1bb]' // Gold
  if (style >= 3) return 'border-[#9da7b3] bg-[#9da7b3]/20 text-[#dde1e5]' // Silver
  return 'border-[#c9755b] bg-[#c9755b]/20 text-[#e9c7bd]' // Bronze
}

/** 発動数 count に対する活性ティア（最大の minUnits<=count）。未発動は null。 */
export function activeTier(
  count: number,
  tiers: [number, number][],
): { min: number; style: number } | null {
  let best: { min: number; style: number } | null = null
  for (const [min, style] of tiers) if (count >= min) best = { min, style }
  return best
}

/** スターレベル → ★の配色（3=金,2=銀,1=銅） */
export function starColor(star: number): string {
  switch (star) {
    case 3:
      return 'text-[#f2b968]'
    case 2:
      return 'text-[#9da7b3]'
    default:
      return 'text-[#c9755b]'
  }
}

/** コスト → ユニットアイコン枠の配色（MetaTFT基準: 1=灰,2=緑,3=青,4=紫,5=金） */
export function costBorder(cost: number): string {
  switch (cost) {
    case 5:
      return 'border-[#e4b238]'
    case 4:
      return 'border-[#b630c4]'
    case 3:
      return 'border-[#2c76e9]'
    case 2:
      return 'border-[#11b288]'
    default:
      return 'border-[#696969]'
  }
}

/**
 * 平均順位 → ティア。MetaTFTに合わせたカラーパレット（左端の縦線などに使用）。
 */
export function tierOf(avgPlace: number): { label: string; color: string; classes: string } {
  if (avgPlace <= 3.5)
    return { label: 'S', color: '#ff7e83', classes: 'bg-[#ff7e83] text-[#222222]' }
  if (avgPlace <= 4.0)
    return { label: 'A', color: '#ffbf7f', classes: 'bg-[#ffbf7f] text-[#222222]' }
  if (avgPlace <= 4.5)
    return { label: 'B', color: '#ffd572', classes: 'bg-[#ffd572] text-[#222222]' }
  if (avgPlace <= 5.2)
    return { label: 'C', color: '#579e56', classes: 'bg-[#579e56] text-white' }
  return { label: 'D', color: '#666666', classes: 'bg-[#666666] text-white' }
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
