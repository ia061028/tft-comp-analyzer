import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WireDrillFile, WireSummaryFile } from '../../shared/types'
import { drillTypes } from './drill'

const summary: WireSummaryFile = {
  schemaVersion: 1,
  generatedAt: '',
  setNumber: 18,
  defaultKey: '18.3',
  // 掘り下げファイルとは並びを変えておく（api で引き当てること）
  traits: [
    { api: 'B', name: 'Bravo', nameJa: 'ブラボー', icon: 'b.png', tiers: [[2, 1], [4, 3]] },
    { api: 'A', name: 'Alpha', nameJa: 'アルファ', icon: 'a.png', tiers: [[2, 1], [4, 3]] },
  ],
  emblems: [],
  views: [],
}

const drill: WireDrillFile = {
  schemaVersion: 1,
  generatedAt: '',
  key: '18.3',
  traits: ['A', 'B'],
  units: [
    { api: 'U1', name: 'Ann', nameJa: 'アン', cost: 1, icon: 'u1.png' },
    { api: 'U2', name: 'Bob', nameJa: 'ボブ', cost: 2, icon: 'u2.png' },
  ],
  rows: [
    {
      t: 0,
      m: 4,
      sp: [
        [
          { p: 1, s: [8, 24, 5, 2, 68], b: [0, 1], bs: [4, 10], u: [[1, 8, 6, 15, 12], [0, 4, 0, 0, 14]] },
          { p: -1, s: [2, 14, 0, 0, 16], b: [0], bs: [2, 14], u: [[0, 2, 0, 0, 14]] },
        ],
        [],
        [{ p: -2, s: [3, 12, 1, 0, 24], b: [], bs: [0, 0], u: [] }],
      ],
    },
  ],
}

test('drillTypes: 相方は api で引き当て、率と平均を出す', () => {
  const [ty, solo] = drillTypes(drill, summary, 'A', 4, 'all', 'ja')
  assert.deepEqual(ty.partner, { name: 'ブラボー', icon: 'b.png' })
  assert.equal(ty.n, 8)
  assert.equal(ty.share, 80)
  assert.equal(ty.avg, 3)
  assert.equal(ty.lv, 8.5)
  assert.deepEqual(
    ty.board.map((u) => u.name),
    ['アン', 'ボブ'],
  )
  assert.equal(ty.boardAvg, 2.5)
  const bob = ty.units[0]
  assert.equal(bob.name, 'ボブ')
  assert.equal(bob.share, 100)
  assert.equal(bob.star3, 75)
  assert.equal(bob.star3Avg, 2.5)
  assert.equal(bob.otherAvg, 6)
  // 星3が0人なら星3時の平均は無い
  assert.equal(ty.units[1].star3Avg, null)
  assert.equal(solo.partner, undefined)
})

test('drillTypes: まとめ行は partner = null、行が無ければ空', () => {
  const [rest] = drillTypes(drill, summary, 'A', 4, 'without', 'en')
  assert.equal(rest.partner, null)
  assert.deepEqual(drillTypes(drill, summary, 'A', 4, 'with', 'en'), [])
  assert.deepEqual(drillTypes(drill, summary, 'B', 2, 'all', 'en'), [])
})
