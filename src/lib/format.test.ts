import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemInfo, TraitInfo, UnitInfo } from '../../shared/types'
import {
  activeTraitCounts,
  bronzeTraitCount,
  shrunk,
  PRIOR_TOP4,
  PRIOR_PLACE,
  PRIOR_WEIGHT,
} from './format'

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

test('activeTraitCounts: 盤面の所持特性を集計', () => {
  const c = activeTraitCounts(comp, [], units, emblems)
  assert.equal(c.get(0), 2) // u0,u1 が Brawler
})

test('activeTraitCounts: 活用紋章の付与を加算（紋章1枚 = +1）', () => {
  const c = activeTraitCounts(comp, [0, 1], units, emblems) // e0(→Brawler), e1(→SpaceGroove)
  assert.equal(c.get(0), 3) // Brawler 2(盤面) + 1(紋章e0)
  assert.equal(c.get(2), 1) // SpaceGroove 1(紋章e1)
})

test('activeTraitCounts: 同一紋章2枚なら +2', () => {
  const c = activeTraitCounts(comp, [0, 0], units, emblems)
  assert.equal(c.get(0), 4) // Brawler 2(盤面) + 2(紋章e0 ×2)
})

test('activeTraitCounts: 活用紋章なしなら付与も無し', () => {
  const c = activeTraitCounts(comp, [], units, emblems)
  assert.equal(c.get(2), undefined)
})

test('activeTraitCounts → bronzeTraitCount: 紋章付与でブロンズが増える', () => {
  const c = activeTraitCounts(comp, [1], units, emblems)
  // Brawler 2(盤面=ブロンズ) ＋ SpaceGroove 1(紋章=ブロンズ) = 2
  assert.equal(bronzeTraitCount(c, traits), 2)
})

// --- 並び順の縮約（ベイズ平滑化） ---

test('shrunk: n=0 は事前平均そのもの', () => {
  assert.equal(shrunk(0, 0, PRIOR_TOP4), PRIOR_TOP4)
  assert.equal(shrunk(0, 0, PRIOR_PLACE), PRIOR_PLACE)
})

test('shrunk: サンプルが増えるほど生の率に収束する', () => {
  const raw = 0.8
  const small = shrunk(4, 5, PRIOR_TOP4) // 採用5件で Top4率 80%
  const large = shrunk(800, 1000, PRIOR_TOP4) // 採用1000件で Top4率 80%
  assert.ok(small < large, '小サンプルの方がベースレートに引き戻される')
  assert.ok(Math.abs(large - raw) < 0.01, '大サンプルはほぼ生の率')
  assert.ok(small > PRIOR_TOP4, 'ベースレートは超える（実績が上回っているため）')
})

test('shrunk: 小サンプルの極端な率が、大サンプルの安定した率を追い越さない', () => {
  // これが導入の目的そのもの: 採用5件80% は 採用500件62% より下に来る。
  const tiny = shrunk(4, 5, PRIOR_TOP4) // 80%
  const solid = shrunk(310, 500, PRIOR_TOP4) // 62%
  assert.ok(tiny < solid, `tiny=${tiny} solid=${solid}`)
})

test('shrunk: 平均順位も同様（小サンプルの好成績は 4.5 側へ引き戻る）', () => {
  const tiny = shrunk(15, 5, PRIOR_PLACE) // 平均3.0 が5件
  const solid = shrunk(1750, 500, PRIOR_PLACE) // 平均3.5 が500件
  assert.ok(tiny > solid, '昇順ソートで solid(実績十分) が上に来る')
})

test('shrunk: weight を大きくするほど事前平均に寄る', () => {
  const w10 = shrunk(4, 5, PRIOR_TOP4, PRIOR_WEIGHT)
  const w100 = shrunk(4, 5, PRIOR_TOP4, 100)
  assert.ok(Math.abs(w100 - PRIOR_TOP4) < Math.abs(w10 - PRIOR_TOP4))
})
