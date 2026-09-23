// 構成カードの見た目に関する純粋なヘルパ群（配色・ティア判定・チームコード生成）。
// CompList と各行コンポーネントから共有する。

import type {
  CompStats,
  EmblemInfo,
  TraitGrant,
  TraitGranter,
  TraitInfo,
  UnitInfo,
} from '../../shared/types'
import { pickName, type Lang } from './i18n'

/**
 * 上乗せ特性を発動数に足す最小シェア。
 *
 * ラックスやカ＝ジックスは選択制なので、同じ盤面でも選択が割れる。過半がその選択だった
 * ものだけを「この構成の発動特性」として数え、それ未満は候補として見せるに留める
 * （盤面に出ていない特性でチップが光ると、構成を真似したときに再現しない）。
 */
export const GRANT_APPLY_SHARE = 0.5

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
 * trait idx → 発動数。行の特性チップ表示と CompList のブロンズ集計で共有する。
 * used は CompRow.used（この行で実際に使われた紋章の多重集合）。
 */
export function activeTraitCounts(
  comp: CompStats,
  used: number[],
  units: UnitInfo[],
  emblems: EmblemInfo[],
  granters: TraitGranter[] = [],
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
  // 静的データに出ない上乗せ（ラックスの選択特性2体分・カ＝ジックスの進化・
  // エルダードラゴンのリフトビースト2体分）。実レコードからの逆算。
  for (const g of appliedGrants(comp, granters)) {
    counts.set(g.trait, (counts.get(g.trait) ?? 0) + g.delta)
  }
  return counts
}

/**
 * 発動数に反映する上乗せ。
 *
 * 1. 過半のレコードでその選択だったもの（`GRANT_APPLY_SHARE`）。
 * 2. 付与元ユニットが分かっているなら、そのユニットの**最頻の選択**は過半に届かなくても足す。
 *
 * 2 が要るのは、ラックスのように「N 択から1つ」の機構は構成の中で選択が割れるから。
 * 実データで ブラックソーン 43% / エルダーウッド 21% / ルナー 18% と割れた構成では
 * 過半の条件だけだと何も足されず、ラックスが盤面に居るのに特性が1つも伸びない盤面になる。
 * IPPEI の決定は「構成キーは分けず、最頻の選択を表示する」なので最頻を採る。
 * カ＝ジックスのように複数同時に取れる機構は、最頻以外も 1 の条件で個別に足される。
 */
export function appliedGrants(comp: CompStats, granters: TraitGranter[] = []): TraitGrant[] {
  const top = new Set<TraitGrant>()
  for (const list of grantsByUnit(comp, granters).values()) if (list[0]) top.add(list[0])
  return (comp.grants ?? []).filter((g) => g.share >= GRANT_APPLY_SHARE || top.has(g))
}

/**
 * 上乗せ特性を付与元ユニットごとに振り分ける（unitIdx → その構成で観測された上乗せ）。
 *
 * granters は集計側が実データから推定した [unitIdx, traitIdx] の対応。推定できなかった
 * トレイト（1トレイトを複数ユニットが付与する等）はどのユニットにも付かない。
 * その場合でも発動数の合計（activeTraitCounts）は正しいままで、
 * 「誰の分か」の表示だけが落ちる。
 */
/** 上乗せ特性1件と、その付与元ユニット。 */
export interface GrantSource {
  /** units 配列インデックス。 */
  unit: number
  grant: TraitGrant
}

/**
 * 上乗せ特性を「伸ばされた特性」から引く（traitIdx → 付与元ユニットと上乗せ）。
 *
 * 発動特性チップに「この数はこの駒のおかげ」を出すためのもの。**発動数に足したものだけ**
 * 入れる（顔が出ている＝その数に入っている、を崩さない）。付与元を推定できなかった
 * 上乗せも入らない（発動数は正しいまま、付与元の表示だけが落ちる）。
 */
export function granterOfTrait(
  comp: CompStats,
  granters: TraitGranter[],
): Map<number, GrantSource> {
  const applied = new Set(appliedGrants(comp, granters))
  const out = new Map<number, GrantSource>()
  for (const [unit, list] of grantsByUnit(comp, granters)) {
    for (const grant of list) if (applied.has(grant)) out.set(grant.trait, { unit, grant })
  }
  return out
}

/**
 * 駒の吹き出しに足す「この駒の選択の割れ方」。ブラックソーン 43% / エルダーウッド 21% のように、
 * 数に入れなかった選択もここで見える（データを隠さない）。上乗せが無ければ空文字。
 */
export function grantChoicesTip(grants: TraitGrant[], traits: TraitInfo[], lang: Lang): string {
  if (grants.length === 0) return ''
  return (
    ' · ' +
    grants
      .map((g) => {
        const t = traits[g.trait]
        return `${t ? pickName(lang, t) : `#${g.trait}`} +${g.delta} ${Math.round(g.share * 100)}%`
      })
      .join(' / ')
  )
}

/** チップの吹き出しに足す「誰が何体分ぶん伸ばしたか」。付与元が無ければ空文字。 */
export function granterTip(
  source: GrantSource | undefined,
  units: UnitInfo[],
  lang: Lang,
): string {
  if (!source) return ''
  const unit = units[source.unit]
  if (!unit) return ''
  const pct = Math.round(source.grant.share * 100)
  return ` · ${pickName(lang, unit)} +${source.grant.delta}${pct < 100 ? ` (${pct}%)` : ''}`
}

export function grantsByUnit(
  comp: CompStats,
  granters: TraitGranter[],
): Map<number, TraitGrant[]> {
  const out = new Map<number, TraitGrant[]>()
  if (!comp.grants?.length || !granters.length) return out
  // 照合はトレイトと上乗せ数の組。同じトレイトでも由来ごとに上乗せ数が違うため
  // （セット18 ではラックスが +2、別経路が +1）、数まで一致したものだけを付与元とする。
  // delta を持たない旧ファイル（schemaVersion 5）はトレイトだけで引けるよう別に持つ。
  const unitOfTraitDelta = new Map<string, number>()
  const unitOfTrait = new Map<number, number>()
  for (const g of granters) {
    const [ui, ti, delta] = g
    if (delta === undefined) unitOfTrait.set(ti, ui)
    else unitOfTraitDelta.set(`${ti}|${delta}`, ui)
  }
  const board = new Set(comp.units)
  for (const g of comp.grants) {
    const ui = unitOfTraitDelta.get(`${g.trait}|${g.delta}`) ?? unitOfTrait.get(g.trait)
    if (ui === undefined || !board.has(ui)) continue
    const list = out.get(ui)
    if (list) list.push(g)
    else out.set(ui, [g])
  }
  for (const list of out.values()) list.sort((a, b) => b.share - a.share || a.trait - b.trait)
  return out
}

/**
 * 実効盤面サイズ。エルダードラゴンのように1体で2枠使うユニットを含む構成は
 * ユニット数より大きい。平均順位はほぼ盤面サイズを測っているので、
 * 比較の基準（同体数コホート）はこちらで切らないと複数枠ユニットの構成が不当に強く見える。
 */
export function effectiveUnits(comp: CompStats): number {
  return comp.units.length + (comp.slotExtra ?? 0)
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
 * 発動している特性の種類数（固有特性も数える）。
 *
 * ゲーム内の「特性ラダー」は**重複しない特性を何種類発動させたか**で報酬が決まり、必要数は
 * 段を追うごとに増える。数えるのは種類であって発動段の高さではないので、ブロンズ1段でも
 * プリズムでも1種類は1種類。
 *
 * 生涯ブロンズ（`bronzeTraitCount`）とは別物。あちらは「最小ティアで発動している非固有特性」
 * を数えるので、固有特性を除外し、段が上がった特性も落とす。ラダーはどちらも数える。
 */
export function activeTraitTotal(counts: Map<number, number>, traits: TraitInfo[]): number {
  let c = 0
  for (const [ti, n] of counts) {
    const tr = traits[ti]
    if (!tr) continue
    if (activeTier(n, tr.tiers)) c++
  }
  return c
}

/**
 * 一覧の並べ替え指標。'place' は**同体数コホートからの差**（＝Tier）で測る。
 * 画面のラベルは i18n の sortTier / sortWin / sortTop4 / sortAdopt。
 */
export type SortKey = 'place' | 'top4' | 'win' | 'adopt'

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
 * 採用数が「十分」と言える下限（＝採用数メーターが満タンになる境界）。
 *
 * 現データの採用数は中央値 9・大半が1桁で、閾値を上げるとほぼ全行が「少ない」側に倒れて
 * 区別が消える（n<40 なら 92% の行が該当）。10 なら約 56% が該当し、かつ縮約ソートの
 * 上位カードには滅多に出ない（上位＝サンプルが十分な行）ので、印が「例外」として機能する。
 */
export const LOW_SAMPLE = 10

/**
 * 採用数の段階（0=ごく少数 … 3=十分）。境界は 2 / 5 / LOW_SAMPLE。
 *
 * 以前は「採用数下限」フィルタで薄い行を一覧から丸ごと消していたが、それだと紋章を2枚以上
 * 使う構成がほぼ全滅していた（実データで2枚使う行 14,121 件のうち 76% が採用数1、既定の
 * 下限5を超えるのは 4.8% だけ）。行を消す代わりに、その行が何試合に裏付けられているかを
 * この段階で常に見せる。並び順は縮約値（shrunk）なので、採用数1の極端な率は上位に来ない。
 */
export function sampleLevel(n: number): 0 | 1 | 2 | 3 {
  if (n < 2) return 0
  if (n < 5) return 1
  if (n < LOW_SAMPLE) return 2
  return 3
}

/**
 * 採用数の段階 → メーターの塗り色と数字の色。
 * 銅＝この率は信じるな、ニュートラル＝そのまま読んでよい。金は紋章の色なので使わない。
 */
export const SAMPLE_TONE: { fill: string; text: string }[] = [
  { fill: 'bg-bronze', text: 'text-bronze' },
  { fill: 'bg-bronze/70', text: 'text-bronze' },
  { fill: 'bg-muted', text: 'text-muted' },
  { fill: 'bg-ink', text: 'text-ink' },
]

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
 * これを「同じ体数の中での相対」に直す基準として使う。**画面には一切出さない**（ティアと色の
 * 根拠のみ）。CompList で1回だけ算出し、FamilyCard・DerivRow に配る。
 * CI でデータが更新されるたびに実際の値が動くので、定数で埋め込まず stats から算出する。
 */
export function cohortPlace(comps: CompStats[], basis: 'sigs' | 'total' = 'sigs'): Map<number, number> {
  const sum = new Map<number, { n: number; p: number }>()
  for (const c of comps) {
    // キーは実効盤面サイズ。エルダードラゴン構成は1体で2枠使うので、ユニット数で切ると
    // 「1体少ない盤面なのに成績が良い」に見えてティアが不当に上がる
    // （実測: 8体+エルダードラゴン=平均3.69 / 8体のみ=4.96）。
    const k = effectiveUnits(c)
    const a = sum.get(k) ?? { n: 0, p: 0 }
    // 基準は行と同じレコード集合で取る。紋章を選んでいれば紋章を活用した試合（sigs）、
    // チャンピオンだけで絞っていれば全試合（total）。
    if (basis === 'total') {
      if (c.total) {
        a.n += c.n
        a.p += c.total.p
      }
    } else {
      for (const sig of c.sigs) {
        a.n += sig.n
        a.p += sig.p
      }
    }
    sum.set(k, a)
  }
  const out = new Map<number, number>()
  for (const [k, a] of sum) if (a.n > 0) out.set(k, a.p / a.n)
  return out
}

/**
 * 同体数コホートからの差でティアを切る（一覧のカードと派生行、両方のティア表示に使う）。
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
