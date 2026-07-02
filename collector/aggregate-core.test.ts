import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StaticData } from './cdragon.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import {
  activeBreakpoint,
  modeMaxNumber,
  dedupeRecords,
  splitBoardUnits,
  classifyEmblems,
  buildStats,
  type LoadedRecord,
} from './aggregate-core.ts'

// ---- 手作りの最小 StaticData フィクスチャ ----
// トレイト2種 bp=[2,4] / 通常ユニット4種+召喚ユニット1種 / 紋章2種 / アイテム2種。
function makeStaticData(): StaticData {
  return {
    setNumber: 17,
    traits: new Map([
      ['TraitA', { name: 'Alpha', nameJa: 'アルファ', icon: 'traitA.png', tiers: [[2, 1], [4, 3]] as [number, number][] }],
      ['TraitB', { name: 'Bravo', nameJa: 'ブラボー', icon: 'traitB.png', tiers: [[2, 1], [4, 3]] as [number, number][] }],
    ]),
    traitBreakpoints: new Map([
      ['TraitA', [2, 4]],
      ['TraitB', [2, 4]],
    ]),
    units: new Map([
      ['TFT_UnitA', { name: 'UnitA', nameJa: 'ユニットA', cost: 1, icon: 'unitA.png', code: 1, traits: ['TraitA'] }],
      ['TFT_UnitB', { name: 'UnitB', nameJa: 'ユニットB', cost: 2, icon: 'unitB.png', code: 2, traits: ['TraitA', 'TraitB'] }],
      ['TFT_UnitC', { name: 'UnitC', nameJa: 'ユニットC', cost: 3, icon: 'unitC.png', code: 3, traits: ['TraitB'] }],
      ['TFT_UnitD', { name: 'UnitD', nameJa: 'ユニットD', cost: 4, icon: 'unitD.png', code: 4, traits: ['TraitA'] }],
      // 召喚ユニット（_Summon サフィックス）。盤面から除外され summonTraitCount に寄与する。
      ['TFT_UnitE_Summon', { name: 'SummonE', nameJa: '召喚E', cost: 1, icon: 'unitE.png', code: 0, traits: ['TraitA'] }],
    ]),
    emblems: new Map([
      ['TFT_Item_EmblemA', { name: 'EmblemA', nameJa: '紋章A', traitApi: 'TraitA', traitApis: ['TraitA'], icon: 'embA.png', base: 'spatula', recipe: ['spat.png', 'baseA.png'] as [string, string] }],
      // 変種を持つ紋章（発動判定で num_units 最大の付与トレイトを採用）。
      ['TFT_Item_EmblemB', { name: 'EmblemB', nameJa: '紋章B', traitApi: 'TraitB', traitApis: ['TraitB', 'TraitA'], icon: 'embB.png', base: 'spatula', recipe: ['spat.png', 'baseB.png'] as [string, string] }],
    ]),
    items: new Map([
      ['TFT_Item_ItemX', { name: 'ItemX', nameJa: 'アイテムX', icon: 'itemX.png', recipe: ['c1.png', 'c2.png'] as [string, string] }],
      ['TFT_Item_ItemY', { name: 'ItemY', nameJa: 'アイテムY', icon: 'itemY.png', recipe: ['c3.png', 'c4.png'] as [string, string] }],
    ]),
    baseItemIcons: { spatula: 'spat.png', fryingPan: 'pan.png' },
    warnings: [],
  }
}

/** ParticipantRecord の最小生成ヘルパ（テスト用）。 */
function rec(p: Partial<ParticipantRecord> & Pick<ParticipantRecord, 'm'>): ParticipantRecord {
  return {
    v: '16.12',
    p: 1,
    t: {},
    e: [],
    u: [],
    lv: 8,
    ts: 0,
    ...p,
  }
}

// ---- activeBreakpoint ----
test('activeBreakpoint: ちょうどBP → そのBP', () => {
  assert.equal(activeBreakpoint(2, [2, 4]), 2)
  assert.equal(activeBreakpoint(4, [2, 4]), 4)
})

test('activeBreakpoint: BP超過 → 直下BP', () => {
  assert.equal(activeBreakpoint(3, [2, 4]), 2)
  assert.equal(activeBreakpoint(5, [2, 4]), 4)
})

test('activeBreakpoint: 最小BP未満 → count（現仕様）', () => {
  assert.equal(activeBreakpoint(1, [2, 4]), 1)
})

test('activeBreakpoint: bps 空・undefined → count', () => {
  assert.equal(activeBreakpoint(3, []), 3)
  assert.equal(activeBreakpoint(3, undefined), 3)
})

test('activeBreakpoint: 未ソート bps でも正しい', () => {
  assert.equal(activeBreakpoint(5, [4, 2]), 4)
  assert.equal(activeBreakpoint(3, [4, 2]), 2)
})

// ---- modeMaxNumber ----
test('modeMaxNumber: 最頻値', () => {
  assert.equal(modeMaxNumber([1, 2, 2, 3]), 2)
})

test('modeMaxNumber: 同数タイは大きい方', () => {
  assert.equal(modeMaxNumber([1, 1, 2, 2]), 2)
})

test('modeMaxNumber: 空 → undefined', () => {
  assert.equal(modeMaxNumber([]), undefined)
})

// ---- dedupeRecords ----
test('dedupeRecords: 同一 (m,p) は先勝ち', () => {
  const all: LoadedRecord[] = [
    { rec: rec({ m: 'M1', p: 1, u: ['first'] }), route: 'sea' },
    { rec: rec({ m: 'M1', p: 1, u: ['dup'] }), route: 'sea' }, // 同一(m,p) → スキップ
    { rec: rec({ m: 'M1', p: 2 }), route: 'sea' }, // 同一 m だが p 違い → 保持
    { rec: rec({ m: 'M2', p: 1 }), route: 'asia' },
  ]
  const { deduped, dupSkipped } = dedupeRecords(all)
  assert.equal(dupSkipped, 1)
  assert.equal(deduped.length, 3)
  assert.deepEqual(deduped[0].rec.u, ['first']) // 先頭が勝つ
})

// ---- splitBoardUnits ----
test('splitBoardUnits: 召喚除外 + summonTraitCount 記録', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB', 'TFT_UnitE_Summon'] })
  const { boardApis, boardSet, summonTraitCount, unresolvedUnits } = splitBoardUnits(r, sd)
  assert.deepEqual(boardApis, ['TFT_UnitA', 'TFT_UnitB'])
  assert.ok(!boardSet.has('TFT_UnitE_Summon'))
  assert.equal(summonTraitCount.get('TraitA'), 1) // 召喚Eの TraitA 寄与
  assert.equal(unresolvedUnits.length, 0)
})

test('splitBoardUnits: 未解決ユニットは記録し盤面から除外', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', u: ['TFT_UnitA', 'UNKNOWN_UNIT'] })
  const { boardApis, unresolvedUnits } = splitBoardUnits(r, sd)
  assert.deepEqual(boardApis, ['TFT_UnitA'])
  assert.deepEqual(unresolvedUnits, ['UNKNOWN_UNIT'])
})

test('splitBoardUnits: 盤面空（召喚のみ）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', u: ['TFT_UnitE_Summon'] })
  const { boardApis, boardSet } = splitBoardUnits(r, sd)
  assert.deepEqual(boardApis, [])
  assert.equal(boardSet.size, 0)
})

// ---- classifyEmblems ----
const noSummon = new Map<string, number>()

test('classifyEmblems: effective==bp → one', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 2 }, e: ['TFT_Item_EmblemA'] })
  const { oneApisArr, halfApisArr, activeEmblemApis } = classifyEmblems(r, sd, noSummon)
  assert.deepEqual(oneApisArr, ['TFT_Item_EmblemA'])
  assert.deepEqual(halfApisArr, [])
  assert.ok(activeEmblemApis.has('TFT_Item_EmblemA'))
})

test('classifyEmblems: effective>bp → half', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 3 }, e: ['TFT_Item_EmblemA'] })
  const { oneApisArr, halfApisArr } = classifyEmblems(r, sd, noSummon)
  assert.deepEqual(oneApisArr, [])
  assert.deepEqual(halfApisArr, ['TFT_Item_EmblemA'])
})

test('classifyEmblems: 召喚補正で effective が 0 → 数えない（発動扱いは維持）', () => {
  const sd = makeStaticData()
  const summon = new Map<string, number>([['TraitA', 2]])
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 2 }, e: ['TFT_Item_EmblemA'] })
  const { oneApisArr, halfApisArr, activeEmblemApis } = classifyEmblems(r, sd, summon)
  assert.deepEqual(oneApisArr, [])
  assert.deepEqual(halfApisArr, [])
  assert.ok(activeEmblemApis.has('TFT_Item_EmblemA')) // 発動はしているので装備者ゲートは通す
})

test('classifyEmblems: tc 欠落 → 数えない（現仕様）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, e: ['TFT_Item_EmblemA'] }) // tc なし
  const { oneApisArr, halfApisArr, activeEmblemApis } = classifyEmblems(r, sd, noSummon)
  assert.deepEqual(oneApisArr, [])
  assert.deepEqual(halfApisArr, [])
  assert.ok(activeEmblemApis.has('TFT_Item_EmblemA'))
})

test('classifyEmblems: 未発動紋章はスキップ（付与トレイト非発動）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitB: 3 }, tc: { TraitB: 2 }, e: ['TFT_Item_EmblemA'] }) // TraitA 非発動
  const { oneApisArr, halfApisArr, activeEmblemApis } = classifyEmblems(r, sd, noSummon)
  assert.deepEqual(oneApisArr, [])
  assert.deepEqual(halfApisArr, [])
  assert.ok(!activeEmblemApis.has('TFT_Item_EmblemA'))
})

test('classifyEmblems: 同一紋章2個 → 2回積む', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 2 }, e: ['TFT_Item_EmblemA', 'TFT_Item_EmblemA'] })
  const { oneApisArr } = classifyEmblems(r, sd, noSummon)
  assert.deepEqual(oneApisArr, ['TFT_Item_EmblemA', 'TFT_Item_EmblemA'])
})

test('classifyEmblems: 変種トレイトは num_units 最大を採用', () => {
  const sd = makeStaticData()
  // EmblemB は traitApis=[TraitB, TraitA]。TraitA(3) > TraitB(2) なので TraitA を採用し
  // effective=3, bp=2 → half。誤って TraitB(2) を採ると effective=2, bp=2 → one になり区別できる。
  const r = rec({ m: 'M', t: { TraitA: 3, TraitB: 1 }, tc: { TraitA: 3, TraitB: 2 }, e: ['TFT_Item_EmblemB'] })
  const { oneApisArr, halfApisArr } = classifyEmblems(r, sd, noSummon)
  assert.deepEqual(oneApisArr, [])
  assert.deepEqual(halfApisArr, ['TFT_Item_EmblemB'])
})

// ---- buildStats（ミニゴールデン） ----
test('buildStats: 2構成（1つは n<MIN_OUTPUT_N で除外）→ WireStatsFile 全体一致', () => {
  const sd = makeStaticData()

  // 構成1: 盤面 {UnitA, UnitB}。4レコード（うち3件が EmblemA を +1 活用）。
  const comp1Emblem = (m: string, p: number): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      p,
      t: { TraitA: 3, TraitB: 1 },
      tc: { TraitA: 2, TraitB: 2 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitA', 'TFT_UnitB'],
      us: [2, 3],
      ui: [[], ['TFT_Item_ItemX']],
    }),
  })
  const target: LoadedRecord[] = [
    comp1Emblem('M1', 1),
    comp1Emblem('M2', 4),
    comp1Emblem('M3', 8),
    // 紋章なしの4件目（acc.n には数えるが sig は作らない）。
    {
      route: 'sea',
      rec: rec({
        m: 'M4',
        p: 4,
        t: { TraitA: 3 },
        tc: { TraitA: 2 },
        u: ['TFT_UnitA', 'TFT_UnitB'],
        us: [2, 3],
        ui: [[], ['TFT_Item_ItemX']],
      }),
    },
    // 構成2: 盤面 {UnitC, UnitD}。2レコード → n<MIN_OUTPUT_N で出力除外。
    { route: 'sea', rec: rec({ m: 'M5', p: 1, t: { TraitB: 3 }, tc: { TraitB: 2 }, u: ['TFT_UnitC', 'TFT_UnitD'], us: [1, 1] }) },
    { route: 'sea', rec: rec({ m: 'M6', p: 2, t: { TraitB: 3 }, tc: { TraitB: 2 }, u: ['TFT_UnitC', 'TFT_UnitD'], us: [1, 1] }) },
  ]

  const { out, diag } = buildStats(target, sd, {
    targetPatch: '16.12',
    tftPatch: '17.5',
    generatedAt: 'FIXED_TS',
  })

  assert.deepStrictEqual(out, {
    schemaVersion: 3,
    generatedAt: 'FIXED_TS',
    patch: '16.12',
    tftPatch: '17.5',
    setNumber: 17,
    totals: { matches: 6, participants: 6, byRoute: { sea: 6 } },
    traits: [
      { api: 'TraitA', name: 'Alpha', nameJa: 'アルファ', icon: 'traitA.png', tiers: [[2, 1], [4, 3]] },
      { api: 'TraitB', name: 'Bravo', nameJa: 'ブラボー', icon: 'traitB.png', tiers: [[2, 1], [4, 3]] },
    ],
    emblems: [
      { api: 'TFT_Item_EmblemA', name: 'EmblemA', nameJa: '紋章A', trait: 0, icon: 'embA.png', base: 'spatula', recipe: ['spat.png', 'baseA.png'] },
    ],
    units: [
      { api: 'TFT_UnitA', name: 'UnitA', nameJa: 'ユニットA', cost: 1, icon: 'unitA.png', code: 1, traits: [0] },
      { api: 'TFT_UnitB', name: 'UnitB', nameJa: 'ユニットB', cost: 2, icon: 'unitB.png', code: 2, traits: [0, 1] },
    ],
    items: [
      { api: 'TFT_Item_ItemX', name: 'ItemX', nameJa: 'アイテムX', icon: 'itemX.png', recipe: ['c1.png', 'c2.png'] },
    ],
    comps: [
      { u: [0, 1], n: 4, g: [[[0], [], 3, 2, 1, 13]], k: [2, 3], i: [[1, 0, 4]], h: [[0, 1, 3]] },
    ],
    baseItemIcons: { spatula: 'spat.png', fryingPan: 'pan.png' },
  })

  // 診断: 盤面グループは2つ（うち1つは出力除外）。
  assert.equal(diag.boardGroupCount, 2)
  assert.equal(diag.noBoard, 0)
  assert.equal(diag.excludedUnresolvedTrait, 0)
})
