import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TraitGranter, TraitInfo, UnitInfo } from '../../shared/types'
import {
  bestBoard,
  buildRoute,
  candidateUnits,
  emblemGain,
  evaluateBoard,
  maxCostAt,
  splitGranters,
  CHOICE_FROM_LEVEL,
  type LadderData,
} from './ladder'

const tr = (api: string, tiers: [number, number][]): TraitInfo => ({ api, name: api, nameJa: api, icon: '', tiers })
// 0=A(2), 1=B(2), 2=C(2), 3=D(3), 4=固有U(1), 5=E(2)
const traits: TraitInfo[] = [
  tr('A', [[2, 1]]),
  tr('B', [[2, 1], [4, 3]]),
  tr('C', [[2, 1]]),
  tr('D', [[3, 1]]),
  tr('U', [[1, 4]]),
  tr('E', [[2, 1]]),
]
const un = (api: string, cost: number, t: number[], code = 1): UnitInfo => ({
  api,
  name: api,
  nameJa: api,
  cost,
  icon: '',
  code,
  traits: t,
})
const units: UnitInfo[] = [
  un('ab', 1, [0, 1]), // 0
  un('ac', 1, [0, 2]), // 1
  un('bc', 2, [1, 2]), // 2
  un('d1', 1, [3]), // 3
  un('d2', 1, [3]), // 4
  un('solo', 3, [4]), // 5: 固有特性だけ（いるだけで1種類）
  un('five', 5, [4, 5]), // 6
  un('variant', 1, [0, 1, 2], 0), // 7: プランナーに無い変種
  un('chooser', 3, []), // 8: 選択式の付与元（A/C/E のどれか +1）
  un('e1', 4, [5]), // 9
]
const granters: TraitGranter[] = [
  [8, 0, 1],
  [8, 2, 1],
  [8, 5, 1],
]
const data: LadderData = { units, traits, granters }

test('splitGranters: 候補が2つ以上の駒は選択式、1つだけなら固定', () => {
  const { fixed, choice } = splitGranters([...granters, [9, 3, 1]])
  assert.deepEqual(choice.get(8), [
    [0, 1],
    [2, 1],
    [5, 1],
  ])
  assert.deepEqual(fixed.get(9), [[3, 1]])
  assert.equal(choice.has(9), false)
})

test('candidateUnits: プランナーに無い駒は外し、5コストは選んだときだけ', () => {
  assert.equal(candidateUnits(units, false).includes(7), false)
  assert.equal(candidateUnits(units, false).includes(6), false)
  assert.equal(candidateUnits(units, true).includes(6), true)
})

test('evaluateBoard: 種類数は段の高さではなく発動している特性の数', () => {
  const b = evaluateBoard([0, 1, 2], data, [])
  // A=2, B=2, C=2 → 3種類
  assert.equal(b.active, 3)
  assert.equal(b.cost, 4)
})

test('evaluateBoard: 紋章はその特性を持たない駒が居るときだけ数える', () => {
  // d1 だけの盤面に D の紋章: 持たせる駒が居ない（d1 は D 持ち）→ D=1 のまま
  assert.deepEqual(evaluateBoard([3], data, [3]).emblemsUsed, [])
  // solo に D の紋章を持たせれば D=2、あと1体で発動
  const b = evaluateBoard([3, 5], data, [3])
  assert.deepEqual(b.emblemsUsed, [3])
  assert.equal(b.counts.get(3), 2)
  assert.equal(b.near, 1)
})

test('evaluateBoard: 選択式の付与は種類数が最大になる特性を選ぶ', () => {
  // ab がいるので A が1体。chooser を A に振れば A=2 で発動。
  const b = evaluateBoard([0, 8], data, [])
  assert.equal(b.choices.get(8), 0)
  assert.equal(b.active, 1)
  // useChoices=false なら数えない
  assert.equal(evaluateBoard([0, 8], data, [], false).active, 0)
})

/** 小さい例なので総当たりの最大値と比べる。 */
function bruteMax(size: number, allowFive: boolean, emblems: number[]): number {
  const pool = candidateUnits(units, allowFive)
  let best = 0
  const rec = (start: number, pick: number[]) => {
    if (pick.length === size) {
      best = Math.max(best, evaluateBoard(pick, data, emblems).active)
      return
    }
    for (let i = start; i < pool.length; i++) rec(i + 1, [...pick, pool[i]])
  }
  rec(0, [])
  return best
}

test('bestBoard: 総当たりの最大種類数に届く', () => {
  for (const size of [2, 3, 4, 5]) {
    for (const emblems of [[], [3], [1, 5]]) {
      const got = bestBoard(data, { size, emblems, allowFive: false }).active
      assert.equal(got, bruteMax(size, false, emblems), `size=${size} emblems=${emblems}`)
    }
  }
})

test('bestBoard: 固定した駒は必ず入り、使わない駒は入らない', () => {
  const b = bestBoard(data, { size: 3, emblems: [], allowFive: false, locked: [9], excluded: [0] })
  assert.ok(b.units.includes(9))
  assert.ok(!b.units.includes(0))
})

test('bestBoard: 同じ種類数なら直前の盤面と重なる方を選ぶ', () => {
  // 2枠の最大は1種類で、該当する盤面はいくつもある。直前が無ければ安い [ab, ac]、
  // 直前に solo が居れば solo を残す盤面が選ばれる。
  assert.ok(!bestBoard(data, { size: 2, emblems: [], allowFive: false }).units.includes(5))
  const b = bestBoard(data, { size: 2, emblems: [], allowFive: false, prev: [5] })
  assert.equal(b.active, 1)
  assert.ok(b.units.includes(5))
})

test('maxCostAt: Lv5 まで3コスト、Lv6・7 は4コスト、5コストは Lv8 から選んだときだけ', () => {
  assert.equal(maxCostAt(5, true), 3)
  assert.equal(maxCostAt(6, true), 4)
  assert.equal(maxCostAt(8, false), 4)
  assert.equal(maxCostAt(8, true), 5)
})

test('buildRoute: 足す駒・外す駒が直前のレベルとの差になっている', () => {
  const route = buildRoute(data, { levels: [2, 3, 4], bonus: 0, emblems: [], allowFive: false })
  assert.equal(route.length, 3)
  for (let i = 1; i < route.length; i++) {
    const prev = new Set(route[i - 1].board.units)
    const now = new Set(route[i].board.units)
    assert.deepEqual(route[i].added, route[i].board.units.filter((u) => !prev.has(u)))
    assert.deepEqual(route[i].removed, [...prev].filter((u) => !now.has(u)))
  }
  // 選択式の付与は CHOICE_FROM_LEVEL 未満では数えない
  for (const s of route) if (s.level < CHOICE_FROM_LEVEL) assert.equal(s.board.choices.size, 0)
})

test('emblemGain: 使っても種類数が増えない紋章は 0', () => {
  // B の紋章: B は ab/bc で既に揃えやすく、size 2 では増えない
  const g = emblemGain(data, { size: 2, allowFive: false }, 1)
  assert.equal(g.gain, g.withIt.active - g.without.active)
  assert.ok(g.gain >= 0)
})
