import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StaticData } from './cdragon.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import { choosersFromGranters, createSummaryBuilder, summaryChoosers, summaryDictionaries } from './summary-core.ts'

// TraitA [2,3] / TraitB [2,4]。紋章A は TraitA、紋章B は TraitB（変種で TraitA も持つ）。
function makeStaticData(): StaticData {
  return {
    setNumber: 18,
    traits: new Map([
      ['TraitA', { name: 'Alpha', nameJa: 'アルファ', icon: 'a.png', tiers: [[2, 1], [3, 3]] as [number, number][] }],
      ['TraitB', { name: 'Bravo', nameJa: 'ブラボー', icon: 'b.png', tiers: [[2, 1], [4, 3]] as [number, number][] }],
    ]),
    units: new Map(),
    emblems: new Map([
      ['EmblemA', { name: 'EmblemA', nameJa: '紋章A', traitApi: 'TraitA', traitApis: ['TraitA'], icon: 'ea.png', base: 'spatula' as const }],
      ['EmblemB', { name: 'EmblemB', nameJa: '紋章B', traitApi: 'TraitB', traitApis: ['TraitB', 'TraitA'], icon: 'eb.png', base: 'spatula' as const }],
    ]),
    emblemAliases: new Map([['EmblemA_Dup', 'EmblemA']]),
    items: new Map(),
    baseItemIcons: { spatula: '', fryingPan: '' },
    warnings: [],
  }
}

function rec(p: Partial<ParticipantRecord>): ParticipantRecord {
  return { m: 'm1', v: '18.0', p: 1, t: {}, e: [], u: [], lv: 8, ts: 0, ...p }
}

test('紋章: 活用した参加者だけを数え、活用なしは noEmblem へ', () => {
  const b = createSummaryBuilder(makeStaticData())
  // 2 体 + 紋章で 3（段 1→2）＝活用
  b.add(rec({ m: 'm1', p: 1, lv: 9, t: { TraitA: 3 }, tc: { TraitA: 3 }, e: ['EmblemA'] }))
  // 3 体 + 紋章で 4。段は 3 のまま＝活用ではない
  b.add(rec({ m: 'm1', p: 5, lv: 8, t: { TraitA: 3 }, tc: { TraitA: 4 }, e: ['EmblemA'] }))
  // 紋章なし
  b.add(rec({ m: 'm2', p: 8, lv: 7 }))
  const out = b.finish()
  assert.deepEqual(out.emblems, [[0, [1, 1, 1, 1, 9]]])
  assert.deepEqual(out.noEmblem, [2, 13, 0, 0, 15])
  assert.equal(out.participants, 3)
  assert.equal(out.matches, 2)
})

test('紋章: 別名は canonical に寄せ、同じ紋章2枚でも1人と数える', () => {
  const b = createSummaryBuilder(makeStaticData())
  b.add(rec({ p: 2, t: { TraitA: 3 }, tc: { TraitA: 3 }, e: ['EmblemA_Dup', 'EmblemA'] }))
  assert.deepEqual(b.finish().emblems, [[0, [1, 2, 1, 0, 8]]])
})

test('特性: 段の下限ごとに、全体・紋章あり・紋章なしへ振り分ける', () => {
  const b = createSummaryBuilder(makeStaticData())
  // TraitA 3（段2）を紋章で到達 → あり
  b.add(rec({ p: 1, t: { TraitA: 3 }, tc: { TraitA: 3 }, e: ['EmblemA'] }))
  // TraitA 3 を紋章なしで → なし
  b.add(rec({ p: 3, t: { TraitA: 3 }, tc: { TraitA: 3 } }))
  // TraitA 4（段2のまま）に紋章 → 余り。全体にだけ入る
  b.add(rec({ p: 5, t: { TraitA: 3 }, tc: { TraitA: 4 }, e: ['EmblemA'] }))
  // TraitB 2（段1）
  b.add(rec({ p: 7, t: { TraitB: 1 }, tc: { TraitB: 3 } }))
  const out = b.finish()
  assert.deepEqual(out.traits, [
    [0, 3, [3, 9, 2, 1, 24], [1, 1, 1, 1, 8], [1, 3, 1, 0, 8]],
    [1, 2, [1, 7, 0, 0, 8], [0, 0, 0, 0, 0], [1, 7, 0, 0, 8]],
  ])
})

test('特性: 変種で段を上げた紋章は、rec.t に載っている変種の側で「あり」', () => {
  const b = createSummaryBuilder(makeStaticData())
  // 紋章B が TraitA（変種）として働き 1 → 2
  b.add(rec({ p: 2, t: { TraitA: 1 }, tc: { TraitA: 2 }, e: ['EmblemB'] }))
  const [row] = b.finish().traits
  assert.deepEqual(row.slice(0, 2), [0, 2])
  assert.equal(row[3][0], 1)
})

test('特性: tc の無い旧レコードは特性に入れない（紋章には入る）', () => {
  const b = createSummaryBuilder(makeStaticData())
  b.add(rec({ p: 1, t: { TraitA: 3 }, e: ['EmblemA'] }))
  const out = b.finish()
  assert.equal(out.traits.length, 0)
  assert.equal(out.emblems.length, 1)
})

test('summaryDictionaries: builder の idx と同じ並びで、紋章の trait は特性の idx', () => {
  const { traits, emblems } = summaryDictionaries(makeStaticData())
  assert.deepEqual(traits.map((t) => t.api), ['TraitA', 'TraitB'])
  assert.deepEqual(emblems.map((e) => [e.api, e.trait]), [['EmblemA', 0], ['EmblemB', 1]])
})

test('区分: レベルは7以下と10以上をまとめ、区分ごとに同じ集計を持つ', () => {
  const b = createSummaryBuilder(makeStaticData())
  b.add(rec({ p: 1, lv: 10, t: { TraitA: 3 }, tc: { TraitA: 3 }, e: ['EmblemA'] }))
  b.add(rec({ p: 3, lv: 11, t: { TraitA: 3 }, tc: { TraitA: 3 } }))
  b.add(rec({ p: 8, lv: 6 }))
  b.add(rec({ p: 5, lv: 8, t: { TraitA: 1 }, tc: { TraitA: 2 } }))
  const out = b.finish()
  // 選択駒が無いので c は常に 0。人の居ない区分は出さない
  assert.deepEqual(
    out.cells!.map((l) => [l.lv, l.c, l.participants]),
    [['7', 0, 1], ['8', 0, 1], ['10', 0, 2]],
  )
  const lv10 = out.cells!.find((l) => l.lv === '10')!
  assert.deepEqual(lv10.emblems, [[0, [1, 1, 1, 1, 10]]])
  assert.deepEqual(lv10.traits, [[0, 3, [2, 4, 2, 1, 21], [1, 1, 1, 1, 10], [1, 3, 1, 0, 11]]])
  assert.deepEqual(out.cells!.find((l) => l.lv === '7')!.noEmblem, [1, 8, 0, 0, 6])
  // 全体は区分の合計
  assert.equal(out.participants, 4)
})

// 選択駒の検証用。Lux は選んだ特性を +2、Kz は進化を +1。Ann は TraitA の素の駒。
function makeChooserData(): StaticData {
  const sd = makeStaticData()
  sd.traits.set('TraitC', { name: 'Charlie', nameJa: 'チャーリー', icon: 'c.png', tiers: [[2, 1], [4, 3]] })
  sd.traits.set('Rival', { name: 'Rival', nameJa: 'ライバル', icon: 'r.png', tiers: [[1, 4]] })
  const unit = (name: string, traits: string[]) => ({ name, nameJa: name, cost: 3, icon: `${name}.png`, code: 0, traits })
  sd.units = new Map([
    ['Lux', unit('Lux', [])],
    ['Kz', unit('Kz', ['Rival'])],
    ['Ann', unit('Ann', ['TraitA'])],
  ])
  return sd
}

const guess = (unitApi: string, traitApi: string, delta: number, confident = true, total = 500) => ({
  unitApi,
  traitApi,
  delta,
  confident,
  total,
})

test('choosersFromGranters: 言い切れる特性が2つ以上の駒だけ。候補は言い切れない特性も含む', () => {
  const choosers = choosersFromGranters([
    guess('Lux', 'TraitA', 2),
    guess('Lux', 'TraitB', 2),
    // 別経路が混じって言い切れないが、ラックスが一番よく同席している
    guess('Lux', 'TraitC', 2, false),
    guess('Kz', 'TraitA', 1, true, 2000),
    guess('Kz', 'TraitB', 1, true, 2000),
    // 1特性だけの付与元（エルダードラゴン相当）は選択駒にしない
    guess('Elder', 'TraitC', 1),
  ])
  assert.deepEqual(
    choosers.map((c) => [c.api, c.delta, [...c.traits].sort()]),
    [
      ['Kz', 1, ['TraitA', 'TraitB']],
      ['Lux', 2, ['TraitA', 'TraitB', 'TraitC']],
    ],
  )
})

test('区分: 選択駒の有無をビットで分け、選んだ特性を picks に数える', () => {
  const sd = makeChooserData()
  const choosers = [
    { api: 'Lux', delta: 2, traits: new Set(['TraitA', 'TraitB', 'TraitC']) },
    { api: 'Kz', delta: 1, traits: new Set(['TraitA', 'TraitB']) },
  ]
  const b = createSummaryBuilder(sd, choosers)
  // ラックスで TraitC を選んだ（C: 2）。Ann で A は 1 のまま（未発動）
  b.add(rec({ p: 2, u: ['Lux', 'Ann'], t: { TraitC: 1 }, tc: { TraitC: 2, TraitA: 1 } }))
  // カジックスが A と B に進化、ラックスは居ない。A は Ann と合わせて 2
  b.add(rec({ p: 4, u: ['Kz', 'Ann'], t: { TraitA: 1, Rival: 4 }, tc: { TraitA: 2, TraitB: 1, Rival: 1 } }))
  // 両方居る。ラックスは B を選び、カジックスは A に進化
  b.add(rec({ p: 1, u: ['Lux', 'Kz'], t: { TraitB: 1, Rival: 4 }, tc: { TraitB: 2, TraitA: 1, Rival: 1 } }))
  // どちらも居ない
  b.add(rec({ p: 7, u: ['Ann'] }))
  const out = b.finish()
  assert.deepEqual(
    out.cells!.map((c) => [c.c, c.participants]),
    [[0, 1], [1, 1], [2, 1], [3, 1]],
  )
  // [選択駒, 特性] … 特性の idx: TraitA 0 / TraitB 1 / TraitC 2
  assert.deepEqual(
    out.picks!.map(([ci, ti, s]) => [ci, ti, s[0], s[1]]),
    [
      [0, 1, 1, 1],
      [0, 2, 1, 2],
      [1, 0, 2, 5],
      [1, 1, 1, 4],
    ],
  )
  const both = out.cells!.find((c) => c.c === 3)!
  assert.deepEqual(both.picks.map(([ci, ti]) => [ci, ti]), [[0, 1], [1, 0]])
})

test('summaryChoosers: 駒の名前と、選べる特性の idx', () => {
  const sd = makeChooserData()
  const [lux] = summaryChoosers(sd, [{ api: 'Lux', delta: 2, traits: new Set(['TraitC', 'TraitA']) }])
  assert.deepEqual(lux, { api: 'Lux', name: 'Lux', nameJa: 'Lux', icon: 'Lux.png', traits: [0, 2] })
})
