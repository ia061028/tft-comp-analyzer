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

// ---- 紋章判定（セット非依存の純関数） ----

/** 紋章アイコンの置き場（セット番号を問わない緩いゲート）。 */
const EMBLEM_ICON_DIR_RE = /item_icons\/traits\//i

/** en_us の紋章アイテム表示名は必ず "<トレイト名> Emblem"。 */
const EMBLEM_NAME_RE = /^(.+) Emblem$/

/** 合成素材の apiName 判定。接頭辞はセットごとに変わる（TFT_Item_ / DA_Component_）ため末尾一致。 */
const SPATULA_RE = /_Spatula$/
const FRYING_PAN_RE = /_FryingPan$/

/** 紋章判定に使うアイテムの部分形。CDragonItem と構造的に互換。 */
export interface EmblemItemLike {
  apiName?: string
  name?: string
  icon?: string
  incompatibleTraits?: string[]
  composition?: string[]
}

/**
 * 紋章アイコンは全セット共通で `item_icons/traits/<base>/set<N>/` 配下に置かれる。
 * 付与トレイトが CDragon 上で空のセットで、紋章を構造的に特定するために使う。
 */
export function emblemIconRe(setNumber: number): RegExp {
  return new RegExp(`/item_icons/traits/[^/]+/set${setNumber}/`, 'i')
}

/**
 * セット番号を問わない「紋章アイテムらしさ」の緩いゲート（収集側・完成アイテム除外用）。
 * 一次情報は incompatibleTraits。それが空でも、紋章アイコン置き場にあり表示名が
 * "... Emblem" のものは紋章とみなす（セット18 の紋章は incompatibleTraits が空）。
 * 表示名の条件は必須。外すとセット6の Mercenary アイテム等が大量に紛れ込む。
 */
export function isEmblemItemLoose(item: EmblemItemLike): boolean {
  if (Array.isArray(item.incompatibleTraits) && item.incompatibleTraits.length > 0) return true
  return EMBLEM_ICON_DIR_RE.test(item.icon ?? '') && EMBLEM_NAME_RE.test(item.name ?? '')
}

/**
 * 1アイテムを選定セットの紋章として解決し、付与トレイト apiName 群を返す（空配列＝当セットの紋章でない）。
 *
 * - 一次: incompatibleTraits を apiName 完全一致 → 表示名一致 の順で解決する。紋章は
 *   「装備者にトレイトを付与する」アイテムで、その付与トレイトは同トレイト重複防止のため
 *   incompatibleTraits に記載される（associatedTraits はオーグメント等にも付くため使えない）。
 * - フォールバック: 一次が0件のときのみ、当該セットのアイコン置き場にあり表示名が
 *   "<トレイト名> Emblem" のものを表示名から解決する。セット18 のように
 *   incompatibleTraits が空で配信されるセットへの対応。
 *   セット限定のアイコンパスで絞るのは必須で、これが無いと旧セットの同名紋章
 *   （例: セット3 の "Elderwood Emblem"）が新セットの同名トレイトに誤マッチする。
 */
export function resolveEmblemTraits(
  item: EmblemItemLike,
  traitApis: ReadonlySet<string>,
  traitNameToApi: ReadonlyMap<string, string>,
  setNumber: number,
): string[] {
  const resolved: string[] = []
  for (const raw of item.incompatibleTraits ?? []) {
    if (traitApis.has(raw)) {
      resolved.push(raw)
      continue
    }
    const api = traitNameToApi.get(raw)
    if (api !== undefined) resolved.push(api)
  }
  if (resolved.length > 0) return resolved

  if (!emblemIconRe(setNumber).test(item.icon ?? '')) return []
  const m = EMBLEM_NAME_RE.exec(item.name ?? '')
  if (!m) return []
  const api = traitNameToApi.get(m[1])
  return api === undefined ? [] : [api]
}

/** composition から合成素材分類を返す。空 composition（合成不可）は 'none'。 */
export function classifyBase(composition: readonly string[]): 'none' | 'spatula' | 'fryingpan' {
  if (composition.some((c) => SPATULA_RE.test(c))) return 'spatula'
  if (composition.some((c) => FRYING_PAN_RE.test(c))) return 'fryingpan'
  return 'none'
}

export interface EmblemContext {
  /** 紋章とみなすアイテムの apiName 集合（全セット横断・緩いゲート）。 */
  emblemSet: Set<string>
  /** items 全体の apiName 集合（CDragon が知っている全アイテム）。 */
  knownItems: Set<string>
  /** 完成アイテム（composition 2要素 かつ 非紋章）の apiName 集合。ユニット別アイテム収集に使用。 */
  completedItems: Set<string>
}

/**
 * 紋章判定用コンテキストを取得する。
 * セット番号を持たないため判定は全セット横断の緩いゲート（isEmblemItemLoose）で行う。
 * records は生の apiName を保存し、セット絞り込みは集計側が行うため過剰包含は無害だが、
 * 取りこぼすと収集し直しが効かないため、収集側は意図的に緩くする。
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
    const isEmblem = isEmblemItemLoose(item)
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
   * 紋章 apiName → 表示名・解決済み traitApi・アイコンURL。
   * traitApi は表示/クラスタ参照用の単一トレイト（先頭の解決トレイト）。
   * traitApis は発動判定用の全付与トレイト集合（Stargazer 等は基底＋変種が全て入る）。
   * 同一トレイトに解決される紋章が複数ある場合は canonical のみをここに載せる（残りは emblemAliases）。
   */
  emblems: Map<string, { name: string; nameJa: string; traitApi: string; traitApis: string[]; icon: string; base: 'none' | 'spatula' | 'fryingpan'; recipe?: [string, string] }>
  /**
   * 重複紋章 apiName → canonical 紋章 apiName。
   * 同一トレイトを付与する紋章が複数配信されるセット（例: セット18 の Flora Fatalis）で、
   * 選択肢が二重に出て統計が分散するのを防ぐ。レコード解決時に正規化する。
   */
  emblemAliases: Map<string, string>
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

/** 紋章候補（canonical 選定前）。 */
interface EmblemCandidate {
  api: string
  name: string
  icon: string
  traitApi: string
  traitApis: string[]
  comp: string[]
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
  const traitApiSet = new Set(traits.keys())

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

  // emblems。付与トレイトが選定セットのトレイトに解決できるものだけを紋章として採用する。
  // これにより他セットのスパチュラ系アイテムや、別機構（オーグメント/Anima 系）は自然に除外される。
  const allIconsMap = new Map<string, string>()
  for (const item of data.items ?? []) {
    if (item.apiName && item.icon) {
      allIconsMap.set(item.apiName, iconUrl(item.icon))
    }
  }

  const candidates: EmblemCandidate[] = []
  let unresolvedEmblemCount = 0
  for (const item of data.items ?? []) {
    if (!item.apiName) continue
    const traitApis = resolveEmblemTraits(item, traitApiSet, traitNameToApi, setNumber)
    if (traitApis.length === 0) {
      // 付与トレイトを持つ（＝他セットの紋章）が選定セットに解決できないものだけ警告に数える。
      if (Array.isArray(item.incompatibleTraits) && item.incompatibleTraits.length > 0) {
        unresolvedEmblemCount++
      }
      continue
    }
    candidates.push({
      api: item.apiName,
      name: item.name ?? item.apiName,
      icon: item.icon ?? '',
      traitApi: traitApis[0],
      traitApis,
      comp: item.composition ?? [],
    })
  }
  if (unresolvedEmblemCount > 0) {
    warnings.push(
      `付与トレイトが選定セット外のため除外したアイテム ${unresolvedEmblemCount} 種（他セットのスパチュラ系等）`,
    )
  }

  // 同一トレイトに解決される紋章が複数ある場合の canonical 選定。
  // 「合成レシピを持つ方」を優先し、同条件なら items 配列の出現順で先勝ち（決定的）。
  const canonicalByTrait = new Map<string, EmblemCandidate>()
  for (const c of candidates) {
    const prev = canonicalByTrait.get(c.traitApi)
    if (prev === undefined || (prev.comp.length !== 2 && c.comp.length === 2)) {
      canonicalByTrait.set(c.traitApi, c)
    }
  }

  const emblems = new Map<string, { name: string; nameJa: string; traitApi: string; traitApis: string[]; icon: string; base: 'none' | 'spatula' | 'fryingpan'; recipe?: [string, string] }>()
  const emblemAliases = new Map<string, string>()
  for (const c of candidates) {
    const canonical = canonicalByTrait.get(c.traitApi)!
    if (canonical.api !== c.api) {
      emblemAliases.set(c.api, canonical.api)
      continue
    }
    emblems.set(c.api, {
      name: c.name,
      nameJa: ja.items.get(c.api) ?? c.name,
      traitApi: c.traitApi,
      traitApis: c.traitApis,
      icon: iconUrl(c.icon),
      base: classifyBase(c.comp),
      recipe: c.comp.length === 2 ? [allIconsMap.get(c.comp[0]) ?? '', allIconsMap.get(c.comp[1]) ?? ''] : undefined,
    })
  }
  if (emblemAliases.size > 0) {
    warnings.push(
      `同一トレイトに解決される重複紋章 ${emblemAliases.size} 種を canonical に統合: ` +
        [...emblemAliases].map(([a, c]) => `${a}→${c}`).sort().join(', '),
    )
  }

  // items（完成アイテム = composition 2要素 かつ 非紋章）。推奨アイテム表示用。
  // 紋章判定は収集側と同じ緩いゲートを使う（他セットの紋章も完成アイテムに混ぜない）。
  const items = new Map<string, { name: string; nameJa: string; icon: string; recipe?: [string, string] }>()
  for (const item of data.items ?? []) {
    if (!item.apiName) continue
    if (isEmblemItemLoose(item)) continue
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
  // 素材の apiName はセットごとに変わる（TFT_Item_Spatula / DA_Component_Spatula）ため、
  // 選定セットの紋章 composition に実際に現れた素材から引く。無ければ旧来値にフォールバック。
  const usedComponents: string[] = []
  for (const c of candidates) for (const x of c.comp) if (!usedComponents.includes(x)) usedComponents.push(x)
  const spatulaApi = usedComponents.find((c) => SPATULA_RE.test(c)) ?? 'TFT_Item_Spatula'
  const fryingPanApi = usedComponents.find((c) => FRYING_PAN_RE.test(c)) ?? 'TFT_Item_FryingPan'
  const baseItemIcons = {
    spatula: allIconsMap.get(spatulaApi) ?? '',
    fryingPan: allIconsMap.get(fryingPanApi) ?? '',
  }

  return { setNumber, traits, units, emblems, emblemAliases, items, baseItemIcons, warnings }
}
