import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StaticData } from './cdragon.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import {
  modeMaxNumber,
  dedupeRecords,
  splitBoardUnits,
  classifyEmblems,
  buildStats,
  type LoadedRecord,
} from './aggregate-core.ts'

// ---- 手作りの最小 StaticData フィクスチャ ----
// トレイト2種 / 通常ユニット4種+召喚ユニット1種 / 紋章2種 / アイテム2種。
function makeStaticData(): StaticData {
  return {
    setNumber: 17,
    traits: new Map([
      ['TraitA', { name: 'Alpha', nameJa: 'アルファ', icon: 'traitA.png', tiers: [[2, 1], [4, 3]] as [number, number][] }],
      ['TraitB', { name: 'Bravo', nameJa: 'ブラボー', icon: 'traitB.png', tiers: [[2, 1], [4, 3]] as [number, number][] }],
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
      // 変種を持つ紋章（付与トレイトのいずれかが発動していれば活用）。
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
test('splitBoardUnits: 召喚は盤面から除外', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB', 'TFT_UnitE_Summon'] })
  const { boardApis, boardSet, unresolvedUnits } = splitBoardUnits(r, sd)
  assert.deepEqual(boardApis, ['TFT_UnitA', 'TFT_UnitB'])
  assert.ok(!boardSet.has('TFT_UnitE_Summon'))
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

// ---- classifyEmblems（活用 = 装備 AND 付与トレイト発動 の二値） ----
test('classifyEmblems: 付与トレイトが発動していれば活用', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, e: ['TFT_Item_EmblemA'] })
  const { active, activeEmblemApis, unresolvedEmblems } = classifyEmblems(r, sd)
  assert.deepEqual(active, ['TFT_Item_EmblemA'])
  assert.ok(activeEmblemApis.has('TFT_Item_EmblemA'))
  assert.deepEqual(unresolvedEmblems, [])
})

test('classifyEmblems: 発動数(tc)には依存しない（余っていても活用）', () => {
  const sd = makeStaticData()
  // 旧実装では tc=3 > bp=2 で「+0.5（余りあり）」だったケース。今は単に活用。
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 3 }, e: ['TFT_Item_EmblemA'] })
  assert.deepEqual(classifyEmblems(r, sd).active, ['TFT_Item_EmblemA'])
  // tc 自体が無くても判定できる（旧実装ではシグネチャから除外されていた）。
  const noTc = rec({ m: 'M', t: { TraitA: 3 }, e: ['TFT_Item_EmblemA'] })
  assert.deepEqual(classifyEmblems(noTc, sd).active, ['TFT_Item_EmblemA'])
})

test('classifyEmblems: 未発動紋章はスキップ（付与トレイト非発動）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitB: 3 }, e: ['TFT_Item_EmblemA'] }) // TraitA 非発動
  const { active, activeEmblemApis } = classifyEmblems(r, sd)
  assert.deepEqual(active, [])
  assert.ok(!activeEmblemApis.has('TFT_Item_EmblemA'))
})

test('classifyEmblems: 同一紋章2個 → 多重度を保って2回積む', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, e: ['TFT_Item_EmblemA', 'TFT_Item_EmblemA'] })
  assert.deepEqual(classifyEmblems(r, sd).active, ['TFT_Item_EmblemA', 'TFT_Item_EmblemA'])
})

test('classifyEmblems: 変種トレイトはいずれかが発動していれば活用', () => {
  const sd = makeStaticData()
  // EmblemB は traitApis=[TraitB, TraitA]。TraitB は非発動だが TraitA が発動 → 活用。
  const r = rec({ m: 'M', t: { TraitA: 3 }, e: ['TFT_Item_EmblemB'] })
  assert.deepEqual(classifyEmblems(r, sd).active, ['TFT_Item_EmblemB'])
})

test('classifyEmblems: 未解決紋章は記録して無視', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, e: ['TFT_Item_Unknown', 'TFT_Item_EmblemA'] })
  const { active, unresolvedEmblems } = classifyEmblems(r, sd)
  assert.deepEqual(active, ['TFT_Item_EmblemA'])
  assert.deepEqual(unresolvedEmblems, ['TFT_Item_Unknown'])
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
    schemaVersion: 4,
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
      { u: [0, 1], n: 4, g: [[[0], 3, 2, 1, 13]], k: [2, 3], i: [[1, 0, 4]], h: [[0, 1, 3]] },
    ],
    baseItemIcons: { spatula: 'spat.png', fryingPan: 'pan.png' },
  })

  // 診断: 盤面グループは2つ（うち1つは出力除外）。
  assert.equal(diag.boardGroupCount, 2)
  assert.equal(diag.noBoard, 0)
  assert.equal(diag.excludedUnresolvedTrait, 0)
})
