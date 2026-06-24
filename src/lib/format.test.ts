import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemInfo, TraitInfo, UnitInfo } from '../../shared/types'
import type { CompUsage } from './multiset'
import { activeTraitCounts, bronzeTraitCount } from './format'

// trait idx: 0=Brawler型(複数ティア), 1=固有(単一ティア), 2=Space Groove型(minUnits=1だが複数ティア)
const traits: TraitInfo[] = [
  { api: 'Brawler', name: 'Brawler', nameJa: 'ブローラー', icon: '', tiers: [[2, 1], [4, 3], [6, 5]] },
  { api: 'Unique', name: 'Unique', nameJa: '固有', icon: '', tiers: [[1, 4]] },
  { api: 'SpaceGroove', name: 'SpaceGroove', nameJa: 'スペースグルーヴ', icon: '', tiers: [[1, 1], [3, 3], [5, 3], [7, 5], [10, 6]] },
]

const counts = (o: Record<number, number>) =>
  new Map<number, number>(Object.entries(o).map(([k, v]) => [Number(k), v] as [number, number]))

test('bronzeTraitCount: 複数ティア特性は先頭ティア発動でブロンズ計上', () => {
  assert.equal(bronzeTraitCount(counts({ 0: 2 }), traits), 1) // Brawler 2 = 先頭ティア
  assert.equal(bronzeTraitCount(counts({ 0: 3 }), traits), 1) // 3 もまだ先頭ティア(<4)
})

test('bronzeTraitCount: 次ティア以上は非計上', () => {
  assert.equal(bronzeTraitCount(counts({ 0: 4 }), traits), 0) // Brawler 4 = シルバー
  assert.equal(bronzeTraitCount(counts({ 0: 6 }), traits), 0) // Brawler 6 = ゴールド
})

test('bronzeTraitCount: 固有特性(単一ティア)は数えない', () => {
  assert.equal(bronzeTraitCount(counts({ 1: 1 }), traits), 0)
  assert.equal(bronzeTraitCount(counts({ 0: 2, 1: 1 }), traits), 1) // 固有を除き Brawler のみ
})

test('bronzeTraitCount: Space Groove型(minUnits=1だが複数ティア)は先頭ティアでブロンズ', () => {
  assert.equal(bronzeTraitCount(counts({ 2: 1 }), traits), 1) // 先頭ティア(1-2)
  assert.equal(bronzeTraitCount(counts({ 2: 3 }), traits), 0) // 2段目(3)に到達
})

test('bronzeTraitCount: 複数のブロンズ特性を合算', () => {
  assert.equal(bronzeTraitCount(counts({ 0: 2, 2: 1 }), traits), 2)
})

test('bronzeTraitCount: 未発動(先頭ティア未満)は計上しない', () => {
  assert.equal(bronzeTraitCount(counts({ 0: 1 }), traits), 0) // Brawler 1 は未発動
})

// activeTraitCounts: 盤面ユニット所持 ＋ 活用紋章付与 を合算
const units: UnitInfo[] = [
  { api: 'u0', name: 'u0', nameJa: 'u0', cost: 1, icon: '', code: 0, traits: [0] }, // Brawler
  { api: 'u1', name: 'u1', nameJa: 'u1', cost: 1, icon: '', code: 0, traits: [0] }, // Brawler
]
const emblems: EmblemInfo[] = [
  { api: 'e0', name: 'e0', nameJa: 'e0', trait: 0, icon: '', base: 'none' }, // → Brawler
  { api: 'e1', name: 'e1', nameJa: 'e1', trait: 2, icon: '', base: 'none' }, // → SpaceGroove
]
const comp: CompStats = { units: [0, 1], n: 1, unitStars: [], unitItems: [], holders: [], sigs: [] }

const usage = (req: Record<number, number>, best: Record<number, number>): CompUsage => ({
  adopt: 1, top4: 0, win: 0, p: 4, x: 0, n: Object.values(req).reduce((a, b) => a + b, 0),
  req: counts(req), best: counts(best),
})

test('activeTraitCounts: 盤面の所持特性を集計', () => {
  const c = activeTraitCounts(comp, usage({}, {}), units, emblems)
  assert.equal(c.get(0), 2) // u0,u1 が Brawler
})

test('activeTraitCounts: 活用紋章(best>=1)の付与を加算、ceil で端数も繰り上げ', () => {
  // 紋章 e1(→SpaceGroove) を活用(best 1) ＋ e0(→Brawler) を 0.5 だけ活用 → ceil で +1
  const c = activeTraitCounts(comp, usage({ 0: 1, 1: 1 }, { 0: 0.5, 1: 1 }), units, emblems)
  assert.equal(c.get(0), 3) // Brawler 2(盤面) + 1(紋章 ceil(0.5))
  assert.equal(c.get(2), 1) // SpaceGroove 1(紋章)
})

test('activeTraitCounts: best=0 の紋章は加算しない', () => {
  const c = activeTraitCounts(comp, usage({ 1: 1 }, { 1: 0 }), units, emblems)
  assert.equal(c.get(2), undefined)
})

test('activeTraitCounts → bronzeTraitCount: 紋章付与でブロンズが増える', () => {
  const c = activeTraitCounts(comp, usage({ 1: 1 }, { 1: 1 }), units, emblems)
  // Brawler 2(盤面=ブロンズ) ＋ SpaceGroove 1(紋章=ブロンズ) = 2
  assert.equal(bronzeTraitCount(c, traits), 2)
})
