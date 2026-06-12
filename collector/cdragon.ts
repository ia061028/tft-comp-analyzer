// Community Dragon の TFT 静的データ（en_us.json）から紋章コンテキストを取得する最小実装。
// Phase 3 でトレイト/ユニット辞書・アイコンURL変換に拡張予定。

const CDRAGON_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json'

interface CDragonItem {
  apiName?: string
  associatedTraits?: string[]
}

interface CDragonData {
  items?: CDragonItem[]
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
