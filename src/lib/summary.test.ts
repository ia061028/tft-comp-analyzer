import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WireSummaryFile, WireSummaryView } from '../../shared/types'
import { emblemRows, noEmblemRow, traitRows, sortRows, placeTone } from './summary'

const file: WireSummaryFile = {
  schemaVersion: 1,
  generatedAt: '',
  setNumber: 18,
  defaultKey: '18.3',
  traits: [
    { api: 'A', name: 'Alpha', nameJa: 'アルファ', icon: 'a.png', tiers: [[2, 1], [4, 3]] },
    { api: 'U', name: 'Unique', nameJa: '固有', icon: 'u.png', tiers: [[1, 4]] },
  ],
  emblems: [{ api: 'EA', name: 'Alpha Emblem', nameJa: 'アルファの紋章', trait: 0, icon: 'ea.png', base: 'spatula' }],
  views: [],
}
const view: WireSummaryView = {
  key: '18.3',
  label: '18.3',
  matches: 25,
  participants: 200,
  emblems: [[0, [20, 70, 14, 4, 170]]],
  noEmblem: [180, 830, 86, 21, 1500],
  traits: [
    [0, 2, [100, 450, 50, 12, 800], [10, 40, 6, 2, 85], [85, 390, 42, 9, 680]],
    [0, 4, [5, 10, 5, 3, 48], [0, 0, 0, 0, 0], [5, 10, 5, 3, 48]],
    [1, 1, [30, 105, 20, 6, 250], [0, 0, 0, 0, 0], [30, 105, 20, 6, 250]],
  ],
}

test('emblemRows: 名前は特性名、率と平均、採用率を出す', () => {
  const [r] = emblemRows(file, view, 'ja')
  assert.equal(r.name, 'アルファ')
  assert.equal(r.avg, 3.5)
  assert.equal(r.top4, 70)
  assert.equal(r.win, 20)
  assert.equal(r.lv, 8.5)
  assert.equal(r.share, 10)
})

test('noEmblemRow: 活用なしの参加者', () => {
  assert.equal(noEmblemRow(view, '活用なし')?.n, 180)
})

test('traitRows: 区分の列を選び、人数0の行と固有特性は指定で外す', () => {
  assert.deepEqual(traitRows(file, view, 'ja', 'all', true).map((r) => [r.min, r.n]), [[2, 100], [4, 5], [1, 30]])
  assert.deepEqual(traitRows(file, view, 'ja', 'with', true).map((r) => [r.min, r.n]), [[2, 10]])
  assert.deepEqual(traitRows(file, view, 'ja', 'all', false).map((r) => r.min), [2, 4])
  assert.equal(traitRows(file, view, 'ja', 'all', true)[1].style, 3)
})

test('sortRows: 平均順位は縮約値で並べる（少ない行を平均へ寄せるだけで、採用率では並べない）', () => {
  const rows = traitRows(file, view, 'ja', 'all', true)
  // 4段: 5人で平均 2.00 → 縮約 (10+45)/15 = 3.67。2段: 100人 4.50 → 4.50。固有: 30人 3.50 → 3.75
  assert.deepEqual(sortRows(rows, 'avg', 1, 'ja').map((r) => r.min), [4, 1, 2])
  assert.deepEqual(sortRows(rows, 'share', -1, 'ja').map((r) => r.min), [2, 1, 4])
})

test('placeTone: 4.5 からの差で段を決める', () => {
  assert.equal(placeTone(3.6), 'hot')
  assert.equal(placeTone(4.1), 'warm')
  assert.equal(placeTone(4.4), 'cold')
})
