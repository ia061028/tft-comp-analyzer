// 構成カードの見た目に関する純粋なヘルパ群（配色・ティア判定・チームコード生成）。
// CompList/CompCard から共有する。

import type { CompStats, EmblemInfo, TraitInfo, UnitInfo } from '../../shared/types'
import type { CompUsage } from './multiset'

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

/**
 * 構成＋活用紋章の発動特性数（盤面ユニットの所持特性 ＋ 活用紋章の付与分）。
 * trait idx → 発動数。CompCard の特性チップ表示と CompList のブロンズ集計で共有する。
 */
export function activeTraitCounts(
  comp: CompStats,
  usage: CompUsage,
  units: UnitInfo[],
  emblems: EmblemInfo[],
): Map<number, number> {
  const counts = new Map<number, number>()
  for (const ui of comp.units) {
    for (const ti of units[ui]?.traits ?? []) counts.set(ti, (counts.get(ti) ?? 0) + 1)
  }
  for (const ei of usage.req.keys()) {
    const add = Math.ceil(usage.best.get(ei) ?? 0) // 活用された個数
    if (add <= 0) continue
    const ti = emblems[ei]?.trait
    if (ti == null) continue
    counts.set(ti, (counts.get(ti) ?? 0) + add)
  }
  return counts
}

/**
 * 生涯ブロンズ用: 固有特性（単一ティア）を除き、最小（先頭）ティアで発動中の特性数。
 * 例 Brawler [[2,1],[4,3],[6,5]] は発動数2-3でブロンズ計上、4以上は非計上。
 */
export function bronzeTraitCount(counts: Map<number, number>, traits: TraitInfo[]): number {
  let c = 0
  for (const [ti, n] of counts) {
    const tr = traits[ti]
    if (!tr || tr.tiers.length < 2) continue // 固有特性（単一ティア）は除外
    const at = activeTier(n, tr.tiers)
    if (at && at.min === tr.tiers[0][0]) c++ // 先頭ティアで発動＝ブロンズ
  }
  return c
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
