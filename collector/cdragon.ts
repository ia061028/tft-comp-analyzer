// Community Dragon の TFT 静的データ（en_us.json）から紋章コンテキストを取得する最小実装。
// Phase 3 でトレイト/ユニット辞書・アイコンURL変換に拡張予定。

const CDRAGON_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json'

interface CDragonItem {
  apiName?: string
  associatedTraits?: string[]
  name?: string
  icon?: string
}

interface CDragonTrait {
  apiName?: string
  name?: string
  icon?: string
}

interface CDragonChampion {
  apiName?: string
  name?: string
  cost?: number
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
  /** associatedTraits が非空のアイテム（＝紋章）の apiName 集合。 */
  emblemSet: Set<string>
  /** items 全体の apiName 集合（CDragon が知っている全アイテム）。 */
  knownItems: Set<string>
}

/**
 * 紋章判定用コンテキストを取得する。
 * 名前の正規表現マッチは禁止（紋章 apiName はセット固有で不規則）。
 * associatedTraits が非空配列のアイテムのみを紋章とみなす。
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
  for (const item of items) {
    if (!item.apiName) continue
    knownItems.add(item.apiName)
    if (Array.isArray(item.associatedTraits) && item.associatedTraits.length > 0) {
      emblemSet.add(item.apiName)
    }
  }
  return { emblemSet, knownItems }
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
  /** apiName → 表示名・アイコンURL */
  traits: Map<string, { name: string; icon: string }>
  /** champions apiName → 表示名・コスト・アイコンURL */
  units: Map<string, { name: string; cost: number; icon: string }>
  /** 紋章(associatedTraits 非空のアイテム) apiName → 表示名・解決済み traitApi・アイコンURL */
  emblems: Map<string, { name: string; traitApi: string; icon: string }>
  warnings: string[]
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

  // traits
  const traits = new Map<string, { name: string; icon: string }>()
  const traitNameToApi = new Map<string, string>()
  for (const t of chosen.traits ?? []) {
    if (!t.apiName) continue
    traits.set(t.apiName, { name: t.name ?? t.apiName, icon: iconUrl(t.icon) })
    if (t.name) traitNameToApi.set(t.name, t.apiName)
  }

  // カバレッジ警告
  const uncovered: string[] = []
  for (const rt of recordTraitNames) if (!traits.has(rt)) uncovered.push(rt)
  if (uncovered.length > 0) {
    warnings.push(
      `セット${setNumber}でカバーされないトレイト ${uncovered.length} 種: ${uncovered.sort().join(', ')}`,
    )
  }

  // units（champions）
  const units = new Map<string, { name: string; cost: number; icon: string }>()
  for (const c of chosen.champions ?? []) {
    if (!c.apiName) continue
    const icon = iconUrl(c.squareIcon ?? c.tileIcon ?? c.icon)
    units.set(c.apiName, { name: c.name ?? c.apiName, cost: c.cost ?? 0, icon })
  }

  // emblems（associatedTraits 非空のアイテム）
  const emblems = new Map<string, { name: string; traitApi: string; icon: string }>()
  const unresolvedEmblems: string[] = []
  for (const item of data.items ?? []) {
    if (!item.apiName) continue
    const at = item.associatedTraits
    if (!Array.isArray(at) || at.length === 0) continue
    const raw = at[0]
    // apiName 完全一致 → 表示名一致 の順で解決。
    let traitApi: string | undefined
    if (traits.has(raw)) traitApi = raw
    else if (traitNameToApi.has(raw)) traitApi = traitNameToApi.get(raw)
    if (!traitApi) {
      unresolvedEmblems.push(item.apiName)
      continue
    }
    emblems.set(item.apiName, {
      name: item.name ?? item.apiName,
      traitApi,
      icon: iconUrl(item.icon),
    })
  }
  if (unresolvedEmblems.length > 0) {
    warnings.push(
      `traitApi 解決不能な紋章 ${unresolvedEmblems.length} 種（選定セット外トレイト紐付け、Map除外）`,
    )
  }

  return { setNumber, traits, units, emblems, warnings }
}
