import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemRow } from '../../shared/types'
import { aggregateAny, aggregateUtilized, emblemGames } from './multiset'

/** rows だけ持つ最小の CompStats を作る（aggregateAny/emblemGames は rows のみ参照）。 */
function comp(rows: EmblemRow[]): CompStats {
  return {
    traits: [],
    synergies: [],
    label: '',
    labelJa: '',
    units: [],
    unitStars: [],
    n: 0,
    top4: 0,
    win: 0,
    rows,
    holders: [],
    unitItems: [],
  }
}

const c = comp([
  { e: [], n: 10, top4: 5, win: 1, p: 40 },
  { e: [1], n: 4, top4: 3, win: 1, p: 12 },
  { e: [2], n: 2, top4: 1, win: 0, p: 8 },
  { e: [1, 2], n: 1, top4: 1, win: 1, p: 3 },
])

test('aggregateAny: 単一紋章はその紋章を含む全行を合算', () => {
  assert.deepEqual(aggregateAny(c, [1]), { n: 5, top4: 4, win: 2, p: 15 })
  assert.deepEqual(aggregateAny(c, [2]), { n: 3, top4: 2, win: 1, p: 11 })
})

test('aggregateAny: 複数紋章はORで、両方含む行も二重計上しない', () => {
  // [1],[2],[1,2] の3行が交差 → n=4+2+1=7
  assert.equal(aggregateAny(c, [1, 2]).n, 7)
})

test('aggregateAny: 空 sel は全行合算', () => {
  assert.equal(aggregateAny(c, []).n, 17)
})

test('aggregateAny: 該当紋章なしは 0', () => {
  assert.deepEqual(aggregateAny(c, [99]), { n: 0, top4: 0, win: 0, p: 0 })
})

test('emblemGames: その紋章を含む行の n 合計', () => {
  assert.equal(emblemGames(c, 1), 5)
  assert.equal(emblemGames(c, 2), 3)
  assert.equal(emblemGames(c, 99), 0)
})

test('aggregateUtilized: 単一紋章はその紋章を含む行で集計・usedCount=1', () => {
  // 紋章1を含む行: [1] n=4, [1,2] n=1 → n=5, top4=4, win=2, p=15
  assert.deepEqual(aggregateUtilized(c, [1]), { usedCount: 1, n: 5, top4: 4, win: 2, p: 15 })
})

test('aggregateUtilized: 同時装着がある場合は最大深さの行のみ集計', () => {
  // sel=[1,2]: 最大重なりは行 [1,2] の 2 → その行のみ集計（n=1, top4=1, win=1, p=3）
  assert.deepEqual(aggregateUtilized(c, [1, 2]), { usedCount: 2, n: 1, top4: 1, win: 1, p: 3 })
})

test('aggregateUtilized: 同時装着が無ければ usedCount=1 で単独行を合算', () => {
  // [1] と [2] はあるが [1,2] が無い構成
  const sep = comp([
    { e: [], n: 10, top4: 5, win: 1, p: 40 },
    { e: [1], n: 4, top4: 3, win: 1, p: 12 },
    { e: [2], n: 2, top4: 1, win: 0, p: 8 },
  ])
  // 最大重なりは 1（[1] か [2]）→ overlap==1 の両行を合算: n=6, top4=4, win=1, p=20
  assert.deepEqual(aggregateUtilized(sep, [1, 2]), { usedCount: 1, n: 6, top4: 4, win: 1, p: 20 })
})

test('aggregateUtilized: 該当紋章なしは usedCount=0・全0', () => {
  assert.deepEqual(aggregateUtilized(c, [99]), { usedCount: 0, n: 0, top4: 0, win: 0, p: 0 })
})
