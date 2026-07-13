// 構成カードの見た目に関する純粋なヘルパ群（配色・ティア判定・チームコード生成）。
// CompList/CompCard から共有する。

import type { CompStats, EmblemInfo, TraitInfo, UnitInfo } from '../../shared/types'

/**
 * CDragon の trait effect style 値 → バッジ配色。
 * 一族の彩度に揃えたフラットで視認性の高い配色（Prismatic/Gold/Silver/Bronze）。
 */
export function styleClasses(style: number): string {
  if (style >= 6) return 'border-[#d98fc4]/50 bg-[#d98fc4]/15 text-[#f0cfe5]' // Prismatic
  if (style >= 5) return 'border-[#e8b75c]/50 bg-[#e8b75c]/15 text-[#f4d79e]' // Gold
  if (style >= 3) return 'border-[#9aa6b4]/50 bg-[#9aa6b4]/15 text-[#d6dce3]' // Silver
  return 'border-[#c9755b]/50 bg-[#c9755b]/15 text-[#e3b6a6]' // Bronze
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
 * used は CompRow.used（この行で実際に使われた紋章の多重集合）。
 */
export function activeTraitCounts(
  comp: CompStats,
  used: number[],
  units: UnitInfo[],
  emblems: EmblemInfo[],
): Map<number, number> {
  const counts = new Map<number, number>()
  for (const ui of comp.units) {
    for (const ti of units[ui]?.traits ?? []) counts.set(ti, (counts.get(ti) ?? 0) + 1)
  }
  // 紋章1枚 = その付与特性 +1（同一紋章2枚なら used に2つ入るので自然に +2 になる）。
  for (const ei of used) {
    const ti = emblems[ei]?.trait
    if (ti == null) continue
    counts.set(ti, (counts.get(ti) ?? 0) + 1)
  }
  return counts
}

/**
 * 装備者の割り当て: unitIdx → そのユニットが載せている紋章 emblemIdx[]。
 *
 * comp.holders は「紋章 ei を持っていた unit の候補」を出現頻度順に**紋章あたり最大3件**持つ。
 * そのまま全部を装備者として描くと、1枚しか使っていない紋章が3体に光ってしまう。
 * 紋章ごとに used の枚数ぶんだけ先頭から取り、unit → 紋章 に反転する。
 */
export function holderMap(comp: CompStats, used: number[]): Map<number, number[]> {
  const byUnit = new Map<number, number[]>()
  const needed = new Map<number, number>() // emblemIdx → その紋章を何枚使うか
  for (const ei of used) needed.set(ei, (needed.get(ei) ?? 0) + 1)
  for (const h of comp.holders) {
    const [ei, ui] = h
    const left = needed.get(ei) ?? 0
    if (left <= 0) continue
    needed.set(ei, left - 1)
    byUnit.set(ui, [...(byUnit.get(ui) ?? []), ei])
  }
  return byUnit
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

/**
 * 並び順のための縮約（ベイズ平滑化）。
 *
 * TFT は8人対戦なので理論ベースレートが確定している（Top4=50%、1位=12.5%、平均順位=4.5）。
 * 事前分布を推定する必要がなく、そのまま事前平均として使える。
 * これにより「採用5件で Top4率 80%」が「採用500件で 62%」より上に来るのを防ぐ。
 * n → ∞ で生の率に収束するので、サンプルが十分な構成の順位は歪まない。
 *
 * 注意: 縮約値は**並び順の決定にのみ**使う。カードに表示する数字は生の率のまま
 * （数字を偽らない）。表示値と並び順が一致しない件は並び替えラベルの title で説明する。
 */
export const PRIOR_WEIGHT = 10 // 事前分布の重み ＝「仮想的な10試合」ぶんの重み
export const PRIOR_PLACE = 4.5
export const PRIOR_TOP4 = 0.5
export const PRIOR_WIN = 0.125

export function shrunk(successes: number, n: number, prior: number, weight = PRIOR_WEIGHT): number {
  return (successes + weight * prior) / (n + weight)
}

/**
 * 低サンプル警告の閾値（採用数がこれ未満なら「率を信じるな」の印を出す）。
 *
 * 現データの採用数は中央値 9・大半が1桁で、閾値を上げるとほぼ全行に警告が付いて無意味になる
 * （n<40 なら 92% の行が該当）。10 なら約 56% が該当し、かつ縮約ソートの上位カードには
 * 滅多に出ない（上位＝サンプルが十分な行）ので、警告が「例外」として機能する。
 */
export const LOW_SAMPLE = 10

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
 * 同ユニット数コホートの平均順位（盤面ユニット数 → 平均順位）。
 *
 * 平均順位は構成の強さではなく**盤面ユニット数**をほぼ測っている（実データで 7体=5.60 …
 * 10体=1.95）。10体を並べられた＝終盤まで生き残った＝すでに勝っていた、というだけで因果が逆。
 * そのため絶対値でティアを切ると 10体構成が全部 S になり、色が情報を運ばなくなる。
 *
 * これを「同じ体数の中での相対」に直す基準として使う。**画面には一切出さない**（色の根拠のみ）。
 * CI でデータが更新されるたびに実際の値が動くので、定数で埋め込まず stats から算出する。
 */
export function cohortPlace(comps: CompStats[]): Map<number, number> {
  const sum = new Map<number, { n: number; p: number }>()
  for (const c of comps) {
    const k = c.units.length
    const a = sum.get(k) ?? { n: 0, p: 0 }
    for (const sig of c.sigs) {
      a.n += sig.n
      a.p += sig.p
    }
    sum.set(k, a)
  }
  const out = new Map<number, number>()
  for (const [k, a] of sum) if (a.n > 0) out.set(k, a.p / a.n)
  return out
}

/**
 * 同体数コホートからの差でティアを切る（派生行の平均順位の色にだけ使う）。
 * 順位は小さいほど良いので、edge が負＝同じ体数の中では良い。
 * コホートが不明な体数（データが薄い）は絶対値のティアにフォールバックする。
 */
export function tierOfEdge(
  avgPlace: number,
  unitCount: number,
  cohort: Map<number, number>,
): { label: string; color: string; classes: string } {
  const base = cohort.get(unitCount)
  if (base == null) return tierOf(avgPlace)
  const edge = avgPlace - base
  if (edge <= -1.5) return { label: 'S', color: '#ff6b7a', classes: 'bg-[#ff6b7a] text-[#1a1112]' }
  if (edge <= -0.7) return { label: 'A', color: '#ff9d5c', classes: 'bg-[#ff9d5c] text-[#1a1410]' }
  if (edge <= -0.3) return { label: 'B', color: '#ecc64f', classes: 'bg-[#ecc64f] text-[#1a1710]' }
  if (edge <= 0.3) return { label: 'C', color: '#6fc06a', classes: 'bg-[#6fc06a] text-[#101a10]' }
  return { label: 'D', color: '#707682', classes: 'bg-[#707682] text-[#0f1012]' }
}

/**
 * 平均順位 → ティア。調和したカラーパレット。
 * color = 左アクセント線・ヒーロー数値の色、classes = ティアバッジの bg/text。
 */
export function tierOf(avgPlace: number): { label: string; color: string; classes: string } {
  if (avgPlace <= 3.5)
    return { label: 'S', color: '#ff6b7a', classes: 'bg-[#ff6b7a] text-[#1a1112]' }
  if (avgPlace <= 4.0)
    return { label: 'A', color: '#ff9d5c', classes: 'bg-[#ff9d5c] text-[#1a1410]' }
  if (avgPlace <= 4.5)
    return { label: 'B', color: '#ecc64f', classes: 'bg-[#ecc64f] text-[#1a1710]' }
  if (avgPlace <= 5.2)
    return { label: 'C', color: '#6fc06a', classes: 'bg-[#6fc06a] text-[#101a10]' }
  return { label: 'D', color: '#707682', classes: 'bg-[#707682] text-[#0f1012]' }
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
