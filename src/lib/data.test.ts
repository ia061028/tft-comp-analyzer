import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeStats, remapSelection } from './data.ts'

test('remapSelection: apiName で突き合わせてインデックスを写す（多重度維持）', () => {
  const from = [{ api: 'A' }, { api: 'B' }, { api: 'C' }]
  const to = [{ api: 'C' }, { api: 'A' }]
  assert.deepEqual(remapSelection([0, 0, 2], from, to), [1, 1, 0])
})

test('remapSelection: 移行先に無い紋章・範囲外インデックスは落とす', () => {
  const from = [{ api: 'A' }, { api: 'B' }]
  const to = [{ api: 'A' }]
  assert.deepEqual(remapSelection([1, 0, 5], from, to), [0])
})

test('remapSelection: 空選択は空', () => {
  assert.deepEqual(remapSelection([], [{ api: 'A' }], [{ api: 'A' }]), [])
})

test('decodeStats: schemaVersion 8 の i / h（先頭ごとの塊）と 7 以前の組（回数つき）を同じ形に開く', () => {
  const base = {
    generatedAt: '',
    patch: '18.3',
    tftPatch: '18.3',
    setNumber: 18,
    totals: { matches: 0, participants: 0, byRoute: {} },
    traits: [],
    emblems: [],
    units: [],
    items: [],
    granters: [],
  }
  const v8 = decodeStats(
    { ...base, schemaVersion: 8, comps: [{ u: [1, 2], n: 3, g: [], i: [[1, 5, 7], [2, 4]], h: [[0, 2, 1]] }] },
    'stats.json',
  )
  const v7 = decodeStats(
    {
      ...base,
      schemaVersion: 7 as 8,
      comps: [{ u: [1, 2], n: 3, g: [], i: [[1, 5, 9], [1, 7, 4], [2, 4, 3]], h: [[0, 2, 6], [0, 1, 2]] }],
    },
    'stats.json',
  )
  for (const s of [v8, v7]) {
    assert.deepEqual(s.comps[0].unitItems, [[1, 5], [1, 7], [2, 4]])
    assert.deepEqual(s.comps[0].holders, [[0, 2], [0, 1]])
  }
})
