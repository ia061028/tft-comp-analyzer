import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emblemIconRe, isEmblemItemLoose, resolveEmblemTraits, classifyBase } from './cdragon.ts'

// 実 CDragon の形をそのまま写したフィクスチャ。
// セット17 は incompatibleTraits で付与トレイトを示すが、セット18 は空で配信される。

const SET17_TRAITS = new Set(['TFT17_ADMIN'])
const SET17_NAME_TO_API = new Map([['Arbiter', 'TFT17_ADMIN']])

const SET18_TRAITS = new Set(['DA_18_Vanguard', 'DA_18_Elderwood', 'DA_FloraFatalis18'])
const SET18_NAME_TO_API = new Map([
  ['Vanguard', 'DA_18_Vanguard'],
  ['Elderwood', 'DA_18_Elderwood'],
  ['Flora Fatalis', 'DA_FloraFatalis18'],
])

const set17Emblem = {
  apiName: 'TFT17_Item_FavoredEmblemItem',
  name: 'Arbiter Emblem',
  icon: 'assets/maps/particles/tft/item_icons/traits/spatula/set17/tft17_emblem_arbiter.tex',
  incompatibleTraits: ['TFT17_ADMIN'],
  composition: ['TFT_Item_Spatula', 'TFT_Item_NegatronCloak'],
}

const set18Emblem = {
  apiName: 'DA_18_EmblemVanguard',
  name: 'Vanguard Emblem',
  icon: 'assets/maps/particles/tft/item_icons/traits/spatula/set18/tft18_emblem_vanguard.tex',
  incompatibleTraits: [],
  composition: ['DA_Component_FryingPan', 'DA_Component_ChainVest'],
}

const set18EmblemNoRecipe = {
  apiName: 'DA_18_EmblemFloraFatalis',
  name: 'Flora Fatalis Emblem',
  icon: 'assets/maps/particles/tft/item_icons/traits/spatula/set18/tft18_emblem_florafatalis.tex',
  incompatibleTraits: [],
  composition: [],
}

// 旧セットの同名紋章。表示名だけで解決すると新セットのトレイトへ誤マッチする。
const set3Emblem = {
  apiName: 'TFT3_Item_ElderwoodEmblemItem',
  name: 'Elderwood Emblem',
  icon: 'assets/maps/particles/tft/item_icons/traits/spatula/set3/tft3_emblem_elderwood.tex',
  incompatibleTraits: [],
  composition: ['TFT_Item_Spatula', 'TFT_Item_ChainVest'],
}

// 完成アイテム（紋章ではない）。
const completedItem = {
  apiName: 'DA_RedBuff',
  name: 'Red Buff',
  icon: 'assets/maps/tft/icons/items/hexcore/tft_item_redbuff.tex',
  incompatibleTraits: [],
  composition: ['DA_Component_RecurveBow', 'DA_Component_RecurveBow'],
}

// アイコンは紋章置き場だが表示名が Emblem で終わらないもの（セット6 Mercenary 等）。
const mercenaryItem = {
  apiName: 'TFT6_Merc_Bag_Spatula',
  name: 'tft_item_name_Mercenary_Bag',
  icon: 'assets/maps/particles/tft/item_icons/traits/spatula/set6/tft6_merc_bag_spatula.tex',
  incompatibleTraits: [],
  composition: ['TFT6_Merc_Bag', 'TFT6_Merc_Spatula'],
}

// ---- emblemIconRe ----

test('emblemIconRe: 当該セットのアイコン置き場だけにマッチする', () => {
  assert.equal(emblemIconRe(18).test(set18Emblem.icon), true)
  assert.equal(emblemIconRe(18).test(set17Emblem.icon), false)
  assert.equal(emblemIconRe(17).test(set17Emblem.icon), true)
  // set1 が set18 に前方一致しないこと（セット番号は境界まで一致させる）。
  assert.equal(emblemIconRe(1).test(set18Emblem.icon), false)
})

// ---- isEmblemItemLoose ----

test('isEmblemItemLoose: incompatibleTraits があれば紋章', () => {
  assert.equal(isEmblemItemLoose(set17Emblem), true)
})

test('isEmblemItemLoose: incompatibleTraits が空でもアイコン置き場＋"... Emblem" 名なら紋章', () => {
  assert.equal(isEmblemItemLoose(set18Emblem), true)
  assert.equal(isEmblemItemLoose(set18EmblemNoRecipe), true)
})

test('isEmblemItemLoose: 完成アイテムは紋章でない', () => {
  assert.equal(isEmblemItemLoose(completedItem), false)
})

test('isEmblemItemLoose: アイコン置き場でも Emblem 名でなければ紋章でない', () => {
  // これを許すとセット6の Mercenary アイテムが大量に完成アイテムから紋章へ移る。
  assert.equal(isEmblemItemLoose(mercenaryItem), false)
})

// ---- resolveEmblemTraits ----

test('resolveEmblemTraits: 一次経路（incompatibleTraits の apiName 完全一致）', () => {
  assert.deepEqual(
    resolveEmblemTraits(set17Emblem, SET17_TRAITS, SET17_NAME_TO_API, 17),
    ['TFT17_ADMIN'],
  )
})

test('resolveEmblemTraits: 一次経路（incompatibleTraits の表示名一致）', () => {
  const item = { ...set17Emblem, incompatibleTraits: ['Arbiter'] }
  assert.deepEqual(resolveEmblemTraits(item, SET17_TRAITS, SET17_NAME_TO_API, 17), ['TFT17_ADMIN'])
})

test('resolveEmblemTraits: フォールバック経路（incompatibleTraits が空 → 表示名から解決）', () => {
  assert.deepEqual(
    resolveEmblemTraits(set18Emblem, SET18_TRAITS, SET18_NAME_TO_API, 18),
    ['DA_18_Vanguard'],
  )
  // トレイト名にスペースを含むケース。
  assert.deepEqual(
    resolveEmblemTraits(set18EmblemNoRecipe, SET18_TRAITS, SET18_NAME_TO_API, 18),
    ['DA_FloraFatalis18'],
  )
})

test('resolveEmblemTraits: 旧セットの同名紋章は新セットに誤マッチしない', () => {
  // セット3の "Elderwood Emblem"。セット18 にも Elderwood トレイトがあるため、
  // セット限定のアイコンパスで絞らないと誤って解決されてしまう。
  assert.deepEqual(resolveEmblemTraits(set3Emblem, SET18_TRAITS, SET18_NAME_TO_API, 18), [])
})

test('resolveEmblemTraits: 他セットの紋章（付与トレイトが解決できない）は空', () => {
  assert.deepEqual(resolveEmblemTraits(set17Emblem, SET18_TRAITS, SET18_NAME_TO_API, 18), [])
})

test('resolveEmblemTraits: 完成アイテムは空', () => {
  assert.deepEqual(resolveEmblemTraits(completedItem, SET18_TRAITS, SET18_NAME_TO_API, 18), [])
})

test('resolveEmblemTraits: 変種を含む incompatibleTraits は全て解決して返す', () => {
  const traits = new Set(['TFT17_Stargazer', 'TFT17_Stargazer_Fountain'])
  const item = {
    apiName: 'TFT17_Item_StargazerEmblemItem',
    name: 'Stargazer Emblem',
    icon: 'assets/maps/particles/tft/item_icons/traits/spatula/set17/tft17_emblem_stargazer.tex',
    incompatibleTraits: ['TFT17_Stargazer', 'TFT17_Stargazer_Fountain'],
    composition: [],
  }
  assert.deepEqual(resolveEmblemTraits(item, traits, new Map(), 17), [
    'TFT17_Stargazer',
    'TFT17_Stargazer_Fountain',
  ])
})

// ---- classifyBase ----

test('classifyBase: 旧セットの素材 apiName', () => {
  assert.equal(classifyBase(['TFT_Item_Spatula', 'TFT_Item_NegatronCloak']), 'spatula')
  assert.equal(classifyBase(['TFT_Item_FryingPan', 'TFT_Item_BFSword']), 'fryingpan')
})

test('classifyBase: セット18 の素材 apiName（接頭辞が DA_Component_ に変わっても分類できる）', () => {
  assert.equal(classifyBase(['DA_Component_Spatula', 'DA_Component_GiantsBelt']), 'spatula')
  assert.equal(classifyBase(['DA_Component_FryingPan', 'DA_Component_ChainVest']), 'fryingpan')
})

test('classifyBase: 合成不可（composition 空）は none', () => {
  assert.equal(classifyBase([]), 'none')
})

test('classifyBase: へら・フライパンを含まない合成は none', () => {
  assert.equal(classifyBase(['DA_Component_RecurveBow', 'DA_Component_BFSword']), 'none')
})
