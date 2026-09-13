import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remapSelection } from './data.ts'

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
