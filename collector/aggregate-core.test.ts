import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StaticData } from './cdragon.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import {
  modeMaxNumber,
  modeMaxFromCounts,
  splitBoardUnits,
  classifyEmblems,
  tierOfCount,
  classifyRecord,
  pickTargetSet,
  pickTargetSetFromCounts,
  buildStats,
  createStatsBuilder,
  expectedTraitCounts,
  inferTraitGrants,
  slotExtraOf,
  MAX_SLOT_EXTRA,
  GRANTER_MIN_RECORDS,
  type LoadedRecord,
} from './aggregate-core.ts'

// ---- 手作りの最小 StaticData フィクスチャ ----
// トレイト2種 / 通常ユニット4種+召喚ユニット1種 / 紋章2種 / アイテム2種。
function makeStaticData(): StaticData {
  return {
    setNumber: 17,
    traits: new Map([
      ['TraitA', { name: 'Alpha', nameJa: 'アルファ', icon: 'traitA.png', tiers: [[2, 1], [3, 3]] as [number, number][] }],
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
    // 同一トレイトを付与する重複紋章（canonical へ正規化される想定）。
    emblemAliases: new Map([['TFT_Item_EmblemA_Dup', 'TFT_Item_EmblemA']]),
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

// ---- pickTargetSet ----
test('pickTargetSet: s を持つレコードの最頻値を返す', () => {
  const recs: LoadedRecord[] = [
    { rec: rec({ m: 'm1', s: 17 }), route: 'asia' },
    { rec: rec({ m: 'm2', s: 18 }), route: 'asia' },
    { rec: rec({ m: 'm3', s: 18 }), route: 'asia' },
    { rec: rec({ m: 'm4' }), route: 'asia' },
  ]
  assert.equal(pickTargetSet(recs), 18)
})

test('pickTargetSet: s を持つレコードが無ければ null', () => {
  const recs: LoadedRecord[] = [
    { rec: rec({ m: 'm1' }), route: 'asia' },
    { rec: rec({ m: 'm2' }), route: 'asia' },
  ]
  assert.equal(pickTargetSet(recs), null)
})

test('pickTargetSet: 同数なら大きいセット番号', () => {
  const recs: LoadedRecord[] = [
    { rec: rec({ m: 'm1', s: 17 }), route: 'asia' },
    { rec: rec({ m: 'm2', s: 18 }), route: 'asia' },
  ]
  assert.equal(pickTargetSet(recs), 18)
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

// ---- pickTargetSetFromCounts / modeMaxFromCounts ----
test('pickTargetSetFromCounts: 最頻値、同数なら大きい方、空は null', () => {
  assert.equal(pickTargetSetFromCounts(new Map([[17, 5], [18, 7]])), 18)
  assert.equal(pickTargetSetFromCounts(new Map([[17, 5], [18, 5]])), 18)
  assert.equal(pickTargetSetFromCounts(new Map()), null)
})

test('modeMaxFromCounts: modeMaxNumber と同じ規則', () => {
  assert.equal(modeMaxFromCounts(new Map([[1, 1], [2, 2], [3, 1]])), 2)
  assert.equal(modeMaxFromCounts(new Map([[1, 2], [2, 2]])), 2)
  assert.equal(modeMaxFromCounts(new Map()), undefined)
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

// ---- classifyEmblems（活用 = 装備 AND 紋章が発動段を上げている） ----
// フィクスチャの TraitA は [2,3]、TraitB は [2,4] の2段。
test('classifyEmblems: 紋章が段を上げていれば活用（2体+紋章で 2 → 段1）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 1 }, tc: { TraitA: 2 }, e: ['TFT_Item_EmblemA'] })
  const { active, activeEmblemApis, unresolvedEmblems } = classifyEmblems(r, sd)
  assert.deepEqual(active, ['TFT_Item_EmblemA'])
  assert.ok(activeEmblemApis.has('TFT_Item_EmblemA'))
  assert.deepEqual(unresolvedEmblems, [])
})

test('classifyEmblems: 段が変わらない紋章は活用ではない（4体で 4、外しても 3 で段2）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 4 }, e: ['TFT_Item_EmblemA'] })
  const { active, activeEmblemApis } = classifyEmblems(r, sd)
  assert.deepEqual(active, [])
  assert.ok(!activeEmblemApis.has('TFT_Item_EmblemA'))
})

test('classifyEmblems: tc を持たない旧レコードは発動していれば活用に縮退', () => {
  const sd = makeStaticData()
  const noTc = rec({ m: 'M', t: { TraitA: 3 }, e: ['TFT_Item_EmblemA'] })
  assert.deepEqual(classifyEmblems(noTc, sd).active, ['TFT_Item_EmblemA'])
})

test('tierOfCount: 到達段は閾値以上の段数', () => {
  const tiers: [number, number][] = [[2, 1], [4, 3]]
  assert.equal(tierOfCount(tiers, 0), 0)
  assert.equal(tierOfCount(tiers, 1), 0)
  assert.equal(tierOfCount(tiers, 2), 1)
  assert.equal(tierOfCount(tiers, 3), 1)
  assert.equal(tierOfCount(tiers, 4), 2)
  assert.equal(tierOfCount(tiers, 9), 2)
})

test('classifyEmblems: 未発動紋章はスキップ（付与トレイト非発動）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitB: 3 }, e: ['TFT_Item_EmblemA'] }) // TraitA 非発動
  const { active, activeEmblemApis } = classifyEmblems(r, sd)
  assert.deepEqual(active, [])
  assert.ok(!activeEmblemApis.has('TFT_Item_EmblemA'))
})

test('classifyEmblems: 同一紋章2個で両方要るなら多重度を保って2回積む（1+2 で 3 → 段2）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 3 }, e: ['TFT_Item_EmblemA', 'TFT_Item_EmblemA'] })
  assert.deepEqual(classifyEmblems(r, sd).active, ['TFT_Item_EmblemA', 'TFT_Item_EmblemA'])
})

test('classifyEmblems: 同一紋章2個で1枚余るなら活用は1枚（2+2 で 4、1枚外しても 3 で段2）', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 4 }, e: ['TFT_Item_EmblemA', 'TFT_Item_EmblemA'] })
  const { active, activeEmblemApis } = classifyEmblems(r, sd)
  assert.deepEqual(active, ['TFT_Item_EmblemA'])
  assert.ok(activeEmblemApis.has('TFT_Item_EmblemA'))
})

test('classifyEmblems: 変種トレイトはいずれかが発動していれば活用', () => {
  const sd = makeStaticData()
  // EmblemB は traitApis=[TraitB, TraitA]。TraitB は非発動だが TraitA が発動し段を上げる → 活用。
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 2 }, e: ['TFT_Item_EmblemB'] })
  assert.deepEqual(classifyEmblems(r, sd).active, ['TFT_Item_EmblemB'])
})

test('classifyEmblems: 未解決紋章は記録して無視', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 2 }, e: ['TFT_Item_Unknown', 'TFT_Item_EmblemA'] })
  const { active, unresolvedEmblems } = classifyEmblems(r, sd)
  assert.deepEqual(active, ['TFT_Item_EmblemA'])
  assert.deepEqual(unresolvedEmblems, ['TFT_Item_Unknown'])
})

test('classifyEmblems: 重複紋章は emblemAliases で canonical に正規化される', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', t: { TraitA: 3 }, tc: { TraitA: 2 }, e: ['TFT_Item_EmblemA_Dup'] })
  const { active, activeEmblemApis, unresolvedEmblems } = classifyEmblems(r, sd)
  assert.deepEqual(active, ['TFT_Item_EmblemA'])
  assert.deepEqual([...activeEmblemApis], ['TFT_Item_EmblemA'])
  assert.deepEqual(unresolvedEmblems, [])
})

// ---- buildStats（ミニゴールデン） ----
test('buildStats: 2構成（1つは n<MIN_OUTPUT_N で除外）→ WireStatsFile 全体一致', () => {
  const sd = makeStaticData()

  // 構成1: 盤面 {UnitA, UnitB}。4レコード（うち3件が EmblemA を +1 活用）。
  // tc と lv は盤面と整合させる: TraitA は UnitA+UnitB+紋章 の3、TraitB は UnitB だけで
  // 未発動なので tc に出ない。lv=2 なので追加盤面枠も 0。
  const comp1Emblem = (m: string, p: number): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      p,
      lv: 2,
      t: { TraitA: 3 },
      tc: { TraitA: 3 },
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
        lv: 2,
        t: { TraitA: 3 },
        tc: { TraitA: 2 },
        u: ['TFT_UnitA', 'TFT_UnitB'],
        us: [2, 3],
        ui: [[], ['TFT_Item_ItemX']],
      }),
    },
    // 構成2: 盤面 {UnitC, UnitD}。2レコード → n<MIN_OUTPUT_N で出力除外。
    { route: 'sea', rec: rec({ m: 'M5', p: 1, lv: 2, t: { TraitB: 3 }, tc: { TraitB: 1 }, u: ['TFT_UnitC', 'TFT_UnitD'], us: [1, 1] }) },
    { route: 'sea', rec: rec({ m: 'M6', p: 2, lv: 2, t: { TraitB: 3 }, tc: { TraitB: 1 }, u: ['TFT_UnitC', 'TFT_UnitD'], us: [1, 1] }) },
  ]

  const { out, diag } = buildStats(target, sd, {
    targetPatch: '16.12',
    tftPatch: '17.5',
    generatedAt: 'FIXED_TS',
  })

  assert.deepStrictEqual(out, {
    schemaVersion: 8,
    generatedAt: 'FIXED_TS',
    patch: '16.12',
    tftPatch: '17.5',
    setNumber: 17,
    totals: { matches: 6, participants: 6, byRoute: { sea: 6 } },
    traits: [
      { api: 'TraitA', name: 'Alpha', nameJa: 'アルファ', icon: 'traitA.png', tiers: [[2, 1], [3, 3]] },
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
      // a は紋章なしの M4 も含む全4件の成績（順位 1,4,8,4）。
      { u: [0, 1], n: 4, a: [3, 1, 17], g: [[[0], 3, 2, 1, 13]], k: [2, 3], i: [[1, 0]], h: [[0, 1]] },
    ],
    compCount: 1,
    granters: [],
    baseItemIcons: { spatula: 'spat.png', fryingPan: 'pan.png' },
  })

  // 診断: 盤面グループは2つ（うち1つは n<MIN_OUTPUT_N で出力除外）。
  assert.equal(diag.boardGroupCount, 2)
  assert.equal(diag.noBoard, 0)
  assert.equal(diag.excludedUnresolvedTrait, 0)
  // 構成2は n 不足で先に落ちるので、紋章なし除外には数えない。
  assert.equal(diag.noSigBoards, 0)
})

// ---- classifyRecord ----
test('classifyRecord: 未解決トレイト / 盤面なし / ok（構成キー）', () => {
  const sd = makeStaticData()
  const bad = classifyRecord(rec({ m: 'M', t: { Unknown: 1 }, u: ['TFT_UnitA'] }), sd)
  assert.equal(bad.kind, 'unresolvedTrait')
  if (bad.kind === 'unresolvedTrait') assert.deepEqual(bad.names, ['Unknown'])

  const empty = classifyRecord(rec({ m: 'M', u: ['TFT_UnitE_Summon', 'UNKNOWN'] }), sd)
  assert.equal(empty.kind, 'noBoard')
  if (empty.kind === 'noBoard') assert.deepEqual(empty.unresolvedUnits, ['UNKNOWN'])

  const ok = classifyRecord(rec({ m: 'M', u: ['TFT_UnitB', 'TFT_UnitA'] }), sd)
  assert.equal(ok.kind, 'ok')
  if (ok.kind === 'ok') {
    assert.equal(ok.boardKey, splitBoardUnits(rec({ m: 'M', u: ['TFT_UnitB', 'TFT_UnitA'] }), sd).boardApis.join('|'))
    assert.equal(ok.boardKey, 'TFT_UnitA|TFT_UnitB')
  }
})

// ---- createStatsBuilder（buildStats との等価性・boardFilter・maxComps） ----

/**
 * 3構成（n=5/4/3）のフィクスチャ。全レコードが EmblemA を活用しているので
 * 「紋章活用レコード数 = 総レコード数」になり、並べ替え順は 5/4/3 のまま。
 * 紋章を持たない盤面は出力されないので、順序・上限のテストには紋章が要る。
 */
function threeComps(): LoadedRecord[] {
  const mk = (m: string, p: number, u: string[], extra: Partial<ParticipantRecord> = {}): LoadedRecord => ({
    route: 'asia',
    rec: rec({ m, p, t: { TraitA: 3 }, u, us: u.map(() => 2), ...extra }),
  })
  const out: LoadedRecord[] = []
  for (let i = 0; i < 5; i++) out.push(mk(`A${i}`, 1 + i, ['TFT_UnitA', 'TFT_UnitB'], { e: ['TFT_Item_EmblemA'], eh: ['TFT_UnitB'], ui: [[], ['TFT_Item_ItemX']] }))
  for (let i = 0; i < 4; i++) out.push(mk(`B${i}`, 1 + i, ['TFT_UnitA', 'TFT_UnitC'], { e: ['TFT_Item_EmblemA'], eh: ['TFT_UnitA'] }))
  for (let i = 0; i < 3; i++) out.push(mk(`C${i}`, 1 + i, ['TFT_UnitB', 'TFT_UnitD'], { e: ['TFT_Item_EmblemA'], eh: ['TFT_UnitD'], ui: [['TFT_Item_ItemY'], []] }))
  return out
}

test('createStatsBuilder: 1件ずつ add した結果は buildStats と一致する', () => {
  const sd = makeStaticData()
  const target = threeComps()
  const opts = { targetPatch: '16.12', tftPatch: '17.5', generatedAt: 'T' }
  const b = createStatsBuilder(sd, opts)
  for (const lr of target) b.add(lr.rec, lr.route)
  assert.deepStrictEqual(b.finish(), buildStats(target, sd, opts))
})

test('buildStats: comps は紋章活用レコード数の降順（全件活用なら n 降順と同じ）', () => {
  const sd = makeStaticData()
  const { out } = buildStats(threeComps(), sd, { targetPatch: 'x', tftPatch: 'x', generatedAt: 'T' })
  assert.deepEqual(out.comps.map((c) => c.n), [5, 4, 3])
})

test('buildStats: boardFilter で除外した盤面は accumulate されないが totals には数える', () => {
  const sd = makeStaticData()
  const target = threeComps()
  const full = buildStats(target, sd, { targetPatch: 'x', tftPatch: 'x', generatedAt: 'T' })
  const filtered = buildStats(target, sd, {
    targetPatch: 'x',
    tftPatch: 'x',
    generatedAt: 'T',
    boardFilter: (key) => key !== 'TFT_UnitA|TFT_UnitC',
  })
  assert.equal(filtered.diag.boardGroupCount, 2)
  assert.deepEqual(filtered.out.totals, full.out.totals)
  assert.deepEqual(filtered.out.comps.map((c) => c.n), [5, 3])
  // フィルタで残った構成の中身は同じ。
  assert.deepStrictEqual(filtered.out.comps[0], full.out.comps[0])
})

test('buildStats: maxComps で上位だけ残り、辞書も残った構成の分だけになる', () => {
  const sd = makeStaticData()
  const target = threeComps()
  const { out } = buildStats(target, sd, { targetPatch: 'x', tftPatch: 'x', generatedAt: 'T', maxComps: 1 })
  assert.equal(out.comps.length, 1)
  assert.equal(out.comps[0].n, 5)
  assert.deepEqual(out.units.map((u) => u.api), ['TFT_UnitA', 'TFT_UnitB'])
  assert.deepEqual(out.items.map((i) => i.api), ['TFT_Item_ItemX']) // ItemY は切られた構成のみ
  // maxComps 0 は無制限。
  const all = buildStats(target, sd, { targetPatch: 'x', tftPatch: 'x', generatedAt: 'T', maxComps: 0 })
  assert.equal(all.out.comps.length, 3)
})

test('buildStats: 代表スターは最頻値（同数なら大きい方）を件数から求める', () => {
  const sd = makeStaticData()
  // 紋章を持たない盤面は出力されないので、スターの検証用でも紋章を1つ載せる。
  const mk = (m: string, star: number): LoadedRecord => ({
    route: 'asia',
    rec: rec({
      m,
      p: 1,
      t: { TraitA: 3 },
      u: ['TFT_UnitA', 'TFT_UnitB'],
      us: [star, 2],
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
    }),
  })
  const { out } = buildStats([mk('1', 1), mk('2', 3), mk('3', 3), mk('4', 1)], sd, { targetPatch: 'x', tftPatch: 'x', generatedAt: 'T' })
  assert.deepEqual(out.comps[0].k, [3, 2])
})

// ---- 出力選定（無sig盤面の除外・紋章活用レコード数での切り方） ----

/**
 * 紋章を使わない人気盤面（n=8）と、紋章を使う小さい盤面（n=3）のフィクスチャ。
 * 総レコード数で切ると前者が残り、紋章活用レコード数で切ると後者が残る。
 */
function popularVsEmblem(): LoadedRecord[] {
  const mk = (m: string, u: string[], extra: Partial<ParticipantRecord> = {}): LoadedRecord => ({
    route: 'asia',
    rec: rec({ m, p: 4, t: { TraitA: 3 }, u, us: u.map(() => 2), ...extra }),
  })
  const out: LoadedRecord[] = []
  // 人気だが紋章ゼロ: 盤面 {UnitA, UnitC} を8レコード。
  for (let i = 0; i < 8; i++) out.push(mk(`P${i}`, ['TFT_UnitA', 'TFT_UnitC']))
  // 小さいが全件紋章あり: 盤面 {UnitB, UnitD} を3レコード。
  for (let i = 0; i < 3; i++) out.push(mk(`E${i}`, ['TFT_UnitB', 'TFT_UnitD'], { e: ['TFT_Item_EmblemA'], eh: ['TFT_UnitD'] }))
  return out
}

test('buildStats: 紋章シグネチャが無い盤面も、総レコード数の上位なら出力する', () => {
  const sd = makeStaticData()
  const { out, diag } = buildStats(popularVsEmblem(), sd, {
    targetPatch: 'x',
    tftPatch: 'x',
    generatedAt: 'T',
  })
  // 紋章で探す用の盤面（n=3）が先、チャンピオンだけで探す用の人気盤面（n=8）が後ろ。
  assert.deepEqual(out.comps.map((c) => c.n), [3, 8])
  // 人気盤面は sig を持たず、全レコードの成績だけを持つ（8件とも4位）。
  assert.deepEqual(out.comps[1].g, [])
  assert.deepEqual(out.comps[1].a, [8, 0, 32])
  assert.equal(diag.noSigBoards, 1)
  assert.equal(diag.popularAdded, 1)
  assert.equal(out.totals.participants, 11)
})

test('buildStats: 上限は「紋章活用レコード数」と「総レコード数」のそれぞれに効き、和集合を出す', () => {
  const sd = makeStaticData()
  // 人気盤面にも紋章を1件だけ足し、両方が紋章の候補になるようにする。
  const target = popularVsEmblem()
  target.push({
    route: 'asia',
    rec: rec({
      m: 'P8',
      p: 4,
      t: { TraitA: 3 },
      u: ['TFT_UnitA', 'TFT_UnitC'],
      us: [2, 2],
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitA'],
    }),
  })
  // 3つ目: 紋章なしで n=4。どちらのランキングでも1位にならない。
  for (let i = 0; i < 4; i++) {
    target.push({
      route: 'asia',
      rec: rec({ m: `Q${i}`, p: 5, t: { TraitA: 3 }, u: ['TFT_UnitB', 'TFT_UnitC'], us: [2, 2] }),
    })
  }
  const opts = { targetPatch: 'x', tftPatch: 'x', generatedAt: 'T' }

  // 上限なし: 全部出る。紋章活用の順（3 → 1）の後ろに、紋章なしの盤面が付く。
  assert.deepEqual(buildStats(target, sd, opts).out.comps.map((c) => c.n), [3, 9, 4])

  // 上限1: 紋章活用の1位（n=3）と総レコード数の1位（n=9）だけが残る。
  const { out, diag } = buildStats(target, sd, { ...opts, maxComps: 1 })
  assert.deepEqual(out.comps.map((c) => c.n), [3, 9])
  assert.equal(diag.popularAdded, 1)
})

test('buildStats: 紋章活用レコード数が同数なら総レコード数の多い方が先', () => {
  const sd = makeStaticData()
  const mk = (m: string, u: string[], withEmblem: boolean): LoadedRecord => ({
    route: 'asia',
    rec: rec({
      m,
      p: 4,
      t: { TraitA: 3 },
      u,
      us: u.map(() => 2),
      ...(withEmblem ? { e: ['TFT_Item_EmblemA'], eh: [u[0]] } : {}),
    }),
  })
  const target: LoadedRecord[] = []
  // 盤面X: 5レコード中3件が紋章あり。
  for (let i = 0; i < 3; i++) target.push(mk(`X${i}`, ['TFT_UnitA', 'TFT_UnitB'], true))
  for (let i = 3; i < 5; i++) target.push(mk(`X${i}`, ['TFT_UnitA', 'TFT_UnitB'], false))
  // 盤面Y: 3レコード全件が紋章あり。
  for (let i = 0; i < 3; i++) target.push(mk(`Y${i}`, ['TFT_UnitC', 'TFT_UnitD'], true))

  const { out } = buildStats(target, sd, { targetPatch: 'x', tftPatch: 'x', generatedAt: 'T' })
  // 紋章活用はどちらも3。総レコード数で X(5) が先。
  assert.deepEqual(out.comps.map((c) => c.n), [5, 3])
})

// ---- 静的データ外の特性上乗せ（ラックス/カ＝ジックス/エルダードラゴン型の機構） ----

test('expectedTraitCounts: 盤面ユニットの所持トレイト ＋ 装備紋章の付与', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB'], e: ['TFT_Item_EmblemA'] })
  const { boardSet } = splitBoardUnits(r, sd)
  const exp = expectedTraitCounts(r, sd, boardSet)
  assert.equal(exp.get('TraitA'), 3) // UnitA + UnitB + 紋章A
  assert.equal(exp.get('TraitB'), 1) // UnitB のみ
})

test('expectedTraitCounts: 重複紋章は canonical の付与トレイトで数える', () => {
  const sd = makeStaticData()
  const r = rec({ m: 'M', u: ['TFT_UnitA'], e: ['TFT_Item_EmblemA_Dup'] })
  const { boardSet } = splitBoardUnits(r, sd)
  assert.equal(expectedTraitCounts(r, sd, boardSet).get('TraitA'), 2)
})

test('inferTraitGrants: 期待値を超えた分だけを上乗せとして返す', () => {
  const sd = makeStaticData()
  // 盤面 {UnitA, UnitB} の静的期待値は TraitA=2, TraitB=1。
  // 実測が TraitA=4, TraitB=1 なら TraitA が +2（ラックス型の2体分）。
  const r = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB'], tc: { TraitA: 4, TraitB: 1 } })
  const { boardSet } = splitBoardUnits(r, sd)
  assert.deepEqual([...inferTraitGrants(r, sd, boardSet)], [['TraitA', 2]])
})

test('inferTraitGrants: 期待値以下・tc 欠落・未知トレイトは拾わない', () => {
  const sd = makeStaticData()
  const board = splitBoardUnits(rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB'] }), sd).boardSet
  // 期待値ちょうど / 下回る → 上乗せなし。
  const same = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB'], tc: { TraitA: 2, TraitB: 1 } })
  assert.equal(inferTraitGrants(same, sd, board).size, 0)
  const fewer = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB'], tc: { TraitA: 1 } })
  assert.equal(inferTraitGrants(fewer, sd, board).size, 0)
  // tc 欠落（旧レコード）→ 逆算できない。
  const old = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB'] })
  assert.equal(inferTraitGrants(old, sd, board).size, 0)
  // 静的データが知らないトレイトは無視（セット跨ぎの混入対策）。
  const unknown = rec({ m: 'M', u: ['TFT_UnitA', 'TFT_UnitB'], tc: { Unknown: 5 } })
  assert.equal(inferTraitGrants(unknown, sd, board).size, 0)
})

test('slotExtraOf: レベルと盤面ユニット数の差をクランプして返す', () => {
  const r = (lv: number): ParticipantRecord => rec({ m: 'M', lv })
  assert.equal(slotExtraOf(r(9), 8), 1) // エルダードラゴン型（1体で2枠）
  assert.equal(slotExtraOf(r(9), 9), 0)
  assert.equal(slotExtraOf(r(8), 9), 0) // 召喚の取りこぼし等で負になっても 0
  assert.equal(slotExtraOf(r(9), 2), MAX_SLOT_EXTRA)
  assert.equal(slotExtraOf(rec({ m: 'M', lv: 0 }), 8), 0)
  assert.equal(slotExtraOf(r(9), 0), 0)
})

test('buildStats: 上乗せ特性・付与元ユニット・追加盤面枠を出力する', () => {
  const sd = makeStaticData()
  // 盤面 {UnitA, UnitB}（静的 TraitA=2, TraitB=1）。UnitB が TraitB を1体分上乗せする想定。
  // 4件中3件で上乗せ（share 0.75）、1件は上乗せなし。lv=3/ユニット2体で追加枠1。
  const withGrant = (m: string, p: number): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      p,
      lv: 3,
      t: { TraitA: 1, TraitB: 1 },
      tc: { TraitA: 2, TraitB: 2 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitA', 'TFT_UnitB'],
    }),
  })
  const target: LoadedRecord[] = [
    withGrant('M1', 1),
    withGrant('M2', 2),
    withGrant('M3', 3),
    {
      route: 'sea',
      rec: rec({
        m: 'M4',
        p: 4,
        lv: 3,
        t: { TraitA: 1 },
        tc: { TraitA: 2 },
        e: ['TFT_Item_EmblemA'],
        eh: ['TFT_UnitB'],
        u: ['TFT_UnitA', 'TFT_UnitB'],
      }),
    },
  ]
  const { out } = buildStats(target, sd, {
    targetPatch: '16.12',
    tftPatch: '17.5',
    generatedAt: 'FIXED_TS',
  })

  const traitB = out.traits.findIndex((t) => t.api === 'TraitB')
  // 紋章A は TraitA を +1 するので TraitA 側は期待どおりで上乗せなし。TraitB だけが出る。
  assert.deepEqual(out.comps[0].x, [[traitB, 1, 3]])
  assert.equal(out.comps[0].s, 1)
})

test('buildStats: 付与元は上乗せと必ず同時に盤面に居たユニットに絞られる', () => {
  const sd = makeStaticData()
  // 盤面1 {UnitA, UnitB} と 盤面2 {UnitB, UnitC} の両方で TraitB が +1 される。
  // 両方に居るのは UnitB だけなので、カバレッジで UnitB が一意に決まる。
  const board1 = (m: string): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      lv: 2,
      t: { TraitA: 1, TraitB: 1 },
      tc: { TraitA: 3, TraitB: 2 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitA', 'TFT_UnitB'],
    }),
  })
  const board2 = (m: string): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      lv: 2,
      t: { TraitA: 1, TraitB: 1 },
      tc: { TraitA: 2, TraitB: 3 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitB', 'TFT_UnitC'],
    }),
  })
  // GRANTER_MIN_RECORDS を超える件数を作る（少数の偶然の一致は推定に使わないため）。
  const target: LoadedRecord[] = []
  for (let i = 0; i < GRANTER_MIN_RECORDS + 20; i++) {
    target.push(board1(`A${i}`), board2(`B${i}`))
  }
  const { out } = buildStats(target, sd, {
    targetPatch: '16.12',
    tftPatch: '17.5',
    generatedAt: 'FIXED_TS',
  })

  const traitB = out.traits.findIndex((t) => t.api === 'TraitB')
  const unitB = out.units.findIndex((u) => u.api === 'TFT_UnitB')
  assert.deepEqual(
    out.granters!.filter(([, t]) => t === traitB),
    [[unitB, traitB, 1]],
  )
})

test('buildStats: 付与元は上乗せ数ごとに分けて推定する', () => {
  const sd = makeStaticData()
  // 同じ TraitB が、盤面1では +1（UnitA が居る）、盤面2では +2（UnitA は居ない）。
  // 上乗せ数を混ぜて数えると UnitA のカバレッジが薄まり、+1 の付与元も落ちてしまう。
  const plusOne = (m: string): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      lv: 2,
      t: { TraitA: 1, TraitB: 1 },
      tc: { TraitA: 3, TraitB: 2 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitA', 'TFT_UnitB'],
    }),
  })
  const plusTwo = (m: string): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      lv: 2,
      t: { TraitA: 1, TraitB: 1 },
      tc: { TraitA: 2, TraitB: 4 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitB', 'TFT_UnitC'],
    }),
  })
  const target: LoadedRecord[] = []
  // +2 の方を多くして、混ぜたときに UnitA のカバレッジが閾値を割るようにする。
  // どちらの組も GRANTER_MIN_RECORDS を超えるようにする。
  for (let i = 0; i < GRANTER_MIN_RECORDS + 20; i++) target.push(plusOne(`A${i}`))
  for (let i = 0; i < (GRANTER_MIN_RECORDS + 20) * 3; i++) target.push(plusTwo(`B${i}`))

  const { out } = buildStats(target, sd, {
    targetPatch: '16.12',
    tftPatch: '17.5',
    generatedAt: 'FIXED_TS',
  })
  const traitB = out.traits.findIndex((t) => t.api === 'TraitB')
  const unitA = out.units.findIndex((u) => u.api === 'TFT_UnitA')
  const unitB = out.units.findIndex((u) => u.api === 'TFT_UnitB')
  const forB = out.granters!.filter(([, t]) => t === traitB).sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0))
  // +1 は UnitA（3件すべてに同席）、+2 は UnitB（UnitA は1件も居ない）。
  assert.deepEqual(forB, [
    [unitA, traitB, 1],
    [unitB, traitB, 2],
  ])
})

test('buildStats: 上乗せのシェアが GRANT_MIN_SHARE 未満なら出力しない', () => {
  const sd = makeStaticData()
  const plain = (m: string): LoadedRecord => ({
    route: 'sea',
    rec: rec({
      m,
      lv: 2,
      t: { TraitA: 1 },
      tc: { TraitA: 3 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitA', 'TFT_UnitB'],
    }),
  })
  // 10件中1件だけ TraitB が上乗せ（share 0.1 < GRANT_MIN_SHARE）。
  const target: LoadedRecord[] = []
  for (let i = 0; i < 9; i++) target.push(plain(`M${i}`))
  target.push({
    route: 'sea',
    rec: rec({
      m: 'M9',
      lv: 2,
      t: { TraitA: 1, TraitB: 1 },
      tc: { TraitA: 3, TraitB: 2 },
      e: ['TFT_Item_EmblemA'],
      eh: ['TFT_UnitB'],
      u: ['TFT_UnitA', 'TFT_UnitB'],
    }),
  })
  const { out } = buildStats(target, sd, {
    targetPatch: '16.12',
    tftPatch: '17.5',
    generatedAt: 'FIXED_TS',
  })
  assert.equal(out.comps[0].x, undefined)
  assert.equal(out.comps[0].s, undefined)
})
