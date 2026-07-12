// Community Dragon の TFT 静的データから紋章/トレイト/ユニット/アイテム辞書を取得する。
// 構造判定は en_us を一次情報とし、表示名は ja_jp も取得して両言語を保持する。

const CDRAGON_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json'
const CDRAGON_URL_JA = 'https://raw.communitydragon.org/latest/cdragon/tft/ja_jp.json'
// チームプランナーのチャンピオン定義（公式バイト値 team_planner_code を含む）。
const TEAMPLANNER_URL =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json'

interface CDragonItem {
  apiName?: string
  associatedTraits?: string[]
  incompatibleTraits?: string[]
  composition?: string[]
  name?: string
  icon?: string
}

interface CDragonTrait {
  apiName?: string
  name?: string
  icon?: string
  effects?: { minUnits?: number; style?: number }[]
}

interface CDragonChampion {
  apiName?: string
  name?: string
  cost?: number
  traits?: string[]
  icon?: string
  squareIcon?: string
  tileIcon?: string
}

interface CDragonSetData {
  number?: number
  traits?: CDragonTrait[]
  champions?: CDragonChampion[]
}

interface CDragonData {
  items?: CDragonItem[]
  setData?: CDragonSetData[]
}

export interface EmblemContext {
  /** incompatibleTraits が非空のアイテム（＝紋章/スパチュラ系）の apiName 集合。 */
  emblemSet: Set<string>
  /** items 全体の apiName 集合（CDragon が知っている全アイテム）。 */
  knownItems: Set<string>
  /** 完成アイテム（composition 2要素 かつ 非紋章）の apiName 集合。ユニット別アイテム収集に使用。 */
  completedItems: Set<string>
}

/**
 * 紋章判定用コンテキストを取得する。
 * 名前の正規表現マッチは禁止（紋章 apiName はセット固有で不規則）。
 * 紋章は「装備者にトレイトを付与する」アイテムで、その付与トレイトは
 * incompatibleTraits（同トレイト重複防止のため記載）に入る。associatedTraits は
 * オーグメントや Anima Squad 系アイテム等にも付くため紋章判定には使えない。
 * よって incompatibleTraits が非空のアイテムのみを紋章とみなす。
 */
export async function getEmblemContext(): Promise<EmblemContext> {
  const res = await fetch(CDRAGON_URL)
  if (!res.ok) {
    throw new Error(`CDragon 取得失敗: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as CDragonData
  const items = data.items ?? []

  const emblemSet = new Set<string>()
  const knownItems = new Set<string>()
  const completedItems = new Set<string>()
  for (const item of items) {
    if (!item.apiName) continue
    knownItems.add(item.apiName)
    const isEmblem = Array.isArray(item.incompatibleTraits) && item.incompatibleTraits.length > 0
    if (isEmblem) emblemSet.add(item.apiName)
    // 完成アイテム = 2コンポーネント合成 かつ 紋章でない。
    if (!isEmblem && Array.isArray(item.composition) && item.composition.length === 2) {
      completedItems.add(item.apiName)
    }
  }
  return { emblemSet, knownItems, completedItems }
}

// ---- フル静的辞書（aggregate 用） ----

const ICON_PREFIX = 'https://raw.communitydragon.org/latest/game/'

/** CDragon の icon パスを配信URLに変換。小文字化・.tex/.dds→.png・プレフィックス前置。 */
function iconUrl(path: string | undefined): string {
  if (!path) return ''
  const lower = path.toLowerCase().replace(/\.(tex|dds)$/, '.png')
  return ICON_PREFIX + lower
}

export interface StaticData {
  setNumber: number
  /** apiName → 表示名(en/ja)・アイコンURL・発動ティア([minUnits, style] 昇順) */
  traits: Map<string, { name: string; nameJa: string; icon: string; tiers: [number, number][] }>
  /** champions apiName → 表示名(en/ja)・コスト・アイコンURL・プランナーcode・所持トレイト(apiName) */
  units: Map<string, { name: string; nameJa: string; cost: number; icon: string; code: number; traits: string[] }>
  /**
   * 紋章(incompatibleTraits で付与トレイトを示すアイテム) apiName → 表示名・解決済み traitApi・アイコンURL。
   * traitApi は表示/クラスタ参照用の単一トレイト（先頭の解決トレイト）。
   * traitApis は発動判定用の全付与トレイト集合（Stargazer 等は基底＋変種が全て入る）。
   */
  emblems: Map<string, { name: string; nameJa: string; traitApi: string; traitApis: string[]; icon: string; base: 'none' | 'spatula' | 'fryingpan'; recipe?: [string, string] }>
  /** 完成アイテム apiName → 表示名(en/ja)・アイコンURL */
  items: Map<string, { name: string; nameJa: string; icon: string; recipe?: [string, string] }>
  /** 合成素材アイテムアイコン（紋章グリッドのカテゴリヘッダ用） */
  baseItemIcons: { spatula: string; fryingPan: string }
  warnings: string[]
}

/** ja_jp を取得して apiName→日本語名 のマップ群を返す。取得失敗時は空マップ（en名にフォールバック）。 */
async function fetchJaNames(
  setNumber: number,
): Promise<{ traits: Map<string, string>; units: Map<string, string>; items: Map<string, string> }> {
  const traits = new Map<string, string>()
  const units = new Map<string, string>()
  const items = new Map<string, string>()
  try {
    const res = await fetch(CDRAGON_URL_JA)
    if (!res.ok) return { traits, units, items }
    const data = (await res.json()) as CDragonData
    const jaSet = (data.setData ?? []).find((s) => s.number === setNumber)
    for (const t of jaSet?.traits ?? []) if (t.apiName && t.name) traits.set(t.apiName, t.name)
    for (const c of jaSet?.champions ?? []) if (c.apiName && c.name) units.set(c.apiName, c.name)
    for (const i of data.items ?? []) if (i.apiName && i.name) items.set(i.apiName, i.name)
  } catch {
    // ネットワーク等の失敗時は en 名にフォールバック（空マップを返す）。
  }
  return { traits, units, items }
}

interface TeamPlannerChampion {
  character_id?: string
  team_planner_code?: number
}

/**
 * チームプランナー定義から character_id → team_planner_code（貼付コードのバイト値）を取得。
 * これが公式の正値。en_us の並び順から推測してはならない。取得失敗時は空マップ（code=0=非対応）。
 */
async function fetchPlannerCodes(setNumber: number): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const res = await fetch(TEAMPLANNER_URL)
    if (!res.ok) return map
    const data = (await res.json()) as Record<string, TeamPlannerChampion[]>
    const list = data[`TFTSet${setNumber}`] ?? []
    for (const c of list) {
      if (c.character_id && typeof c.team_planner_code === 'number') {
        map.set(c.character_id, c.team_planner_code)
      }
    }
  } catch {
    // 取得失敗時はコード未設定（プランナーコードはその分 00 になる）。
  }
  return map
}

/**
 * フル静的辞書を取得。
 * setData から、引数のレコード由来トレイト名集合との交差が最大のセットを選定
 * （同数なら number が大きい方）。最新セット決め打ちはしない。
 */
export async function getStaticData(recordTraitNames: Set<string>): Promise<StaticData> {
  const res = await fetch(CDRAGON_URL)
  if (!res.ok) {
    throw new Error(`CDragon 取得失敗: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as CDragonData
  const sets = data.setData ?? []
  const warnings: string[] = []

  // セット選定: トレイト apiName 集合と recordTraitNames の交差サイズが最大、同数なら number 大。
  let chosen: CDragonSetData | null = null
  let bestInter = -1
  for (const s of sets) {
    const apis = new Set<string>()
    for (const t of s.traits ?? []) if (t.apiName) apis.add(t.apiName)
    let inter = 0
    for (const rt of recordTraitNames) if (apis.has(rt)) inter++
    const sNum = s.number ?? -1
    const chosenNum = chosen?.number ?? -1
    if (inter > bestInter || (inter === bestInter && sNum > chosenNum)) {
      bestInter = inter
      chosen = s
    }
  }
  if (!chosen) {
    throw new Error('CDragon setData が空です')
  }
  const setNumber = chosen.number ?? -1

  // 日本語名（同セット番号から）
  const ja = await fetchJaNames(setNumber)

  // traits
  const traits = new Map<string, { name: string; nameJa: string; icon: string; tiers: [number, number][] }>()
  const traitNameToApi = new Map<string, string>()
  for (const t of chosen.traits ?? []) {
    if (!t.apiName) continue
    const name = t.name ?? t.apiName
    if (t.name) traitNameToApi.set(t.name, t.apiName)
    // effects の {minUnits, style} から発動ティアを昇順に収集（minUnits>0・重複除去）。
    const tierMap = new Map<number, number>()
    for (const e of t.effects ?? []) {
      if (typeof e.minUnits === 'number' && e.minUnits > 0) {
        tierMap.set(e.minUnits, e.style ?? 1)
      }
    }
    const tiers = [...tierMap.entries()].sort((a, b) => a[0] - b[0]) as [number, number][]
    traits.set(t.apiName, {
      name,
      nameJa: ja.traits.get(t.apiName) ?? name,
      icon: iconUrl(t.icon),
      tiers,
    })
  }

  // カバレッジ警告
  const uncovered: string[] = []
  for (const rt of recordTraitNames) if (!traits.has(rt)) uncovered.push(rt)
  if (uncovered.length > 0) {
    warnings.push(
      `セット${setNumber}でカバーされないトレイト ${uncovered.length} 種: ${uncovered.sort().join(', ')}`,
    )
  }

  // units（champions）。プランナーcode は公式の team_planner_code を使う（en_us の並びからは導けない）。
  const plannerCodes = await fetchPlannerCodes(setNumber)
  const units = new Map<string, { name: string; nameJa: string; cost: number; icon: string; code: number; traits: string[] }>()
  for (const c of chosen.champions ?? []) {
    if (!c.apiName) continue
    const icon = iconUrl(c.squareIcon ?? c.tileIcon ?? c.icon)
    const name = c.name ?? c.apiName
    // champion.traits は表示名（"Meeple"等）。apiName へ解決（解決不能は無視）。
    const unitTraits: string[] = []
    for (const raw of c.traits ?? []) {
      if (traits.has(raw)) unitTraits.push(raw)
      else if (traitNameToApi.has(raw)) unitTraits.push(traitNameToApi.get(raw)!)
    }
    units.set(c.apiName, {
      name,
      nameJa: ja.units.get(c.apiName) ?? name,
      cost: c.cost ?? 0,
      icon,
      code: plannerCodes.get(c.apiName) ?? 0,
      traits: unitTraits,
    })
  }

  // emblems（incompatibleTraits で付与トレイトを示すアイテム）
  // 付与トレイトが選定セットのトレイトに解決できるものだけを紋章として採用する。
  // これにより他セットのスパチュラ系アイテムや、別機構（オーグメント/Anima 系）は自然に除外される。
  const allIconsMap = new Map<string, string>()
  for (const item of data.items ?? []) {
    if (item.apiName && item.icon) {
      allIconsMap.set(item.apiName, iconUrl(item.icon))
    }
  }

  const emblems = new Map<string, { name: string; nameJa: string; traitApi: string; traitApis: string[]; icon: string; base: 'none' | 'spatula' | 'fryingpan'; recipe?: [string, string] }>()
  let unresolvedEmblemCount = 0
  for (const item of data.items ?? []) {
    if (!item.apiName) continue
    const incompat = item.incompatibleTraits
    if (!Array.isArray(incompat) || incompat.length === 0) continue
    // incompatibleTraits は付与トレイトの apiName 群（Stargazer 等は基底＋変種が列挙される）。
    // apiName 完全一致 → 表示名一致 の順で、選定セットのトレイトに解決する。
    // 解決できた全 apiName を発動判定用の集合 traitApis とし、先頭を表示/クラスタ用 traitApi とする。
    const traitApis: string[] = []
    for (const raw of incompat) {
      if (traits.has(raw)) traitApis.push(raw)
      else if (traitNameToApi.has(raw)) traitApis.push(traitNameToApi.get(raw)!)
    }
    if (traitApis.length === 0) {
      // 選定セットのトレイトに解決できない＝他セットのアイテム。紋章ではないので静かに除外。
      unresolvedEmblemCount++
      continue
    }
    const name = item.name ?? item.apiName
    const comp = item.composition ?? []
    const base: 'none' | 'spatula' | 'fryingpan' =
      comp.length === 0 ? 'none'
      : comp.includes('TFT_Item_Spatula') ? 'spatula'
      : comp.includes('TFT_Item_FryingPan') ? 'fryingpan'
      : 'none'
    emblems.set(item.apiName, {
      name,
      nameJa: ja.items.get(item.apiName) ?? name,
      traitApi: traitApis[0],
      traitApis,
      icon: iconUrl(item.icon),
      base,
      recipe: comp.length === 2 ? [allIconsMap.get(comp[0]) ?? '', allIconsMap.get(comp[1]) ?? ''] : undefined,
    })
  }
  if (unresolvedEmblemCount > 0) {
    warnings.push(
      `付与トレイトが選定セット外のため除外したアイテム ${unresolvedEmblemCount} 種（他セットのスパチュラ系等）`,
    )
  }

  // items（完成アイテム = composition 2要素 かつ 非紋章）。推奨アイテム表示用。
  const items = new Map<string, { name: string; nameJa: string; icon: string; recipe?: [string, string] }>()
  for (const item of data.items ?? []) {
    if (!item.apiName) continue
    const isEmblem = Array.isArray(item.incompatibleTraits) && item.incompatibleTraits.length > 0
    if (isEmblem) continue
    if (!Array.isArray(item.composition) || item.composition.length !== 2) continue
    const name = item.name ?? item.apiName
    const comp = item.composition ?? []
    items.set(item.apiName, { 
      name, 
      nameJa: ja.items.get(item.apiName) ?? name, 
      icon: iconUrl(item.icon),
      recipe: comp.length === 2 ? [allIconsMap.get(comp[0]) ?? '', allIconsMap.get(comp[1]) ?? ''] : undefined
    })
  }

  // 合成素材アイコン（紋章グリッドのカテゴリヘッダ用）。
  const spatulaItem = (data.items ?? []).find((it) => it.apiName === 'TFT_Item_Spatula')
  const fryingPanItem = (data.items ?? []).find((it) => it.apiName === 'TFT_Item_FryingPan')
  const baseItemIcons = {
    spatula: iconUrl(spatulaItem?.icon),
    fryingPan: iconUrl(fryingPanItem?.icon),
  }

  return { setNumber, traits, units, emblems, items, baseItemIcons, warnings }
}
