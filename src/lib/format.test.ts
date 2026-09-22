import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemInfo, TraitInfo, UnitInfo } from '../../shared/types'
import {
  activeTraitCounts,
  bronzeTraitCount,
  activeTraitTotal,
  sampleLevel,
  shrunk,
  DIM_SAMPLE_MAX,
  LOW_SAMPLE,
  SAMPLE_TONE,
  PRIOR_TOP4,
  PRIOR_PLACE,
  PRIOR_WEIGHT,
  GRANT_APPLY_SHARE,
  appliedGrants,
  effectiveUnits,
  grantsByUnit,
  cohortPlace,
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

// ---- activeTraitTotal（特性ラダー用の「発動している特性の種類数」）----
test('activeTraitTotal: 発動していない特性は数えない', () => {
  assert.equal(activeTraitTotal(counts({ 0: 1 }), traits), 0) // Brawler 1 は最小ティア(2)に届かない
  assert.equal(activeTraitTotal(counts({ 0: 2 }), traits), 1)
})

test('activeTraitTotal: 固有特性も数える（生涯ブロンズとの決定的な違い）', () => {
  assert.equal(activeTraitTotal(counts({ 1: 1 }), traits), 1)
  assert.equal(bronzeTraitCount(counts({ 1: 1 }), traits), 0)
})

test('activeTraitTotal: 段が上がっても1種類は1種類', () => {
  // ラダーの報酬は「重複しない特性を何種類発動させたか」で決まる。段の高さは関係ない。
  assert.equal(activeTraitTotal(counts({ 0: 6 }), traits), 1)
  assert.equal(bronzeTraitCount(counts({ 0: 6 }), traits), 0) // ブロンズは先頭ティアのみ計上
})

test('activeTraitTotal: 発動している種類を数え上げる', () => {
  assert.equal(activeTraitTotal(counts({ 0: 4, 1: 1, 2: 3 }), traits), 3)
  assert.equal(activeTraitTotal(counts({ 0: 1, 1: 1, 2: 3 }), traits), 2) // Brawler 1 は未発動
})

test('activeTraitTotal: 未知の trait idx は無視する', () => {
  assert.equal(activeTraitTotal(counts({ 0: 2, 99: 5 }), traits), 1)
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
const comp: CompStats = { units: [0, 1], n: 1, unitStars: [], unitItems: [], holders: [], sigs: [], grants: [], slotExtra: 0 }

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

test('sampleLevel: 採用数 1 / 2-4 / 5-9 / 10+ の4段階に切る', () => {
  assert.equal(sampleLevel(1), 0)
  assert.equal(sampleLevel(2), 1)
  assert.equal(sampleLevel(4), 1)
  assert.equal(sampleLevel(5), 2)
  assert.equal(sampleLevel(LOW_SAMPLE - 1), 2)
  assert.equal(sampleLevel(LOW_SAMPLE), 3)
  assert.equal(sampleLevel(9999), 3)
})

test('sampleLevel: 段は単調（採用数が増えて段が下がることはない）', () => {
  for (let n = 1; n < 40; n++) assert.ok(sampleLevel(n) >= sampleLevel(n - 1 || 1))
})

test('SAMPLE_TONE: 全ての段に配色がある', () => {
  for (const n of [1, 2, 5, LOW_SAMPLE]) assert.ok(SAMPLE_TONE[sampleLevel(n)])
})

test('薄く描く上限は最下段に収まる（淡い行が「十分」段に混ざらない）', () => {
  assert.equal(sampleLevel(DIM_SAMPLE_MAX), 1)
  assert.ok(sampleLevel(DIM_SAMPLE_MAX) < sampleLevel(LOW_SAMPLE))
})

// ---- 静的データ外の上乗せ特性（ラックス/カ＝ジックス/エルダードラゴン型） ----

/** comp に上乗せ特性を付けたコピー。 */
const withGrants = (grants: CompStats['grants'], slotExtra = 0): CompStats => ({
  ...comp,
  grants,
  slotExtra,
})

test('activeTraitCounts: 過半の上乗せは発動数に足す', () => {
  // 盤面は Brawler 2。上乗せで Brawler +2（ラックス型）。
  const c = activeTraitCounts(
    withGrants([{ trait: 0, delta: 2, n: 8, share: 0.8 }]),
    [],
    units,
    emblems,
  )
  assert.equal(c.get(0), 4)
})

test('activeTraitCounts: 過半に満たない上乗せは発動数に足さない', () => {
  const c = activeTraitCounts(
    withGrants([{ trait: 0, delta: 2, n: 3, share: 0.3 }]),
    [],
    units,
    emblems,
  )
  assert.equal(c.get(0), 2) // 盤面ぶんだけ
})

test('appliedGrants: しきい値ちょうどは採用する', () => {
  const grants = [
    { trait: 0, delta: 1, n: 5, share: GRANT_APPLY_SHARE },
    { trait: 1, delta: 1, n: 4, share: GRANT_APPLY_SHARE - 0.01 },
  ]
  assert.deepEqual(
    appliedGrants(withGrants(grants)).map((g) => g.trait),
    [0],
  )
})

test('grantsByUnit: 付与元が盤面に居る上乗せだけを振り分ける', () => {
  const grants = [
    { trait: 0, delta: 2, n: 8, share: 0.8 }, // 付与元 u0（盤面に居る）
    { trait: 1, delta: 1, n: 6, share: 0.6 }, // 付与元 u9（盤面に居ない）
    { trait: 2, delta: 1, n: 6, share: 0.6 }, // 付与元の推定なし
  ]
  const byUnit = grantsByUnit(withGrants(grants), [
    [0, 0],
    [9, 1],
  ])
  assert.deepEqual([...byUnit.keys()], [0])
  assert.deepEqual(byUnit.get(0)!.map((g) => g.trait), [0])
})

test('grantsByUnit: 同じユニットの複数の上乗せは share 降順', () => {
  const grants = [
    { trait: 1, delta: 1, n: 3, share: 0.3 },
    { trait: 0, delta: 1, n: 9, share: 0.9 },
  ]
  const byUnit = grantsByUnit(withGrants(grants), [
    [0, 0],
    [0, 1],
  ])
  assert.deepEqual(byUnit.get(0)!.map((g) => g.trait), [0, 1])
})

test('effectiveUnits: 複数枠ユニットのぶんだけ盤面サイズが増える', () => {
  assert.equal(effectiveUnits(comp), 2)
  assert.equal(effectiveUnits(withGrants([], 1)), 3)
})

test('cohortPlace: コホートは実効盤面サイズで切る', () => {
  const sig = (n: number, p: number) => ({ e: [], n, top4: 0, win: 0, p })
  // 同じ2体でも、1体で2枠使う構成は3枠コホートに入る。
  const plain: CompStats = { ...comp, sigs: [sig(10, 50)] }
  const twoSlot: CompStats = { ...comp, sigs: [sig(10, 20)], slotExtra: 1 }
  const cohort = cohortPlace([plain, twoSlot])
  assert.equal(cohort.get(2), 5)
  assert.equal(cohort.get(3), 2)
})
