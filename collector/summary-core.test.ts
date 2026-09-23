import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StaticData } from './cdragon.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import { createSummaryBuilder, summaryDictionaries } from './summary-core.ts'

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
