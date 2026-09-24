import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WireSummaryFile, WireSummaryView } from '../../shared/types'
import { emblemRows, filterView, noEmblemRow, pickRows, traitRows, sortRows, placeTone } from './summary'

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

test('filterView: 条件に合う区分を足す。全部「全体」ならそのまま', () => {
  const st = (n: number, p: number): [number, number, number, number, number] => [n, p, 0, 0, n * 8]
  const cell = (lv: '8' | '9', c: number, n: number) => ({
    lv,
    c,
    participants: n,
    emblems: [[0, st(n, n * 4)]] as [number, [number, number, number, number, number]][],
    noEmblem: st(0, 0),
    traits: [[0, 2, st(n, n * 4), st(0, 0), st(n, n * 4)]] as WireSummaryView['traits'],
    picks: c & 1 ? ([[0, 0, st(n, n * 3)]] as [number, number, [number, number, number, number, number]][]) : [],
  })
  const v: WireSummaryView = { ...view, cells: [cell('8', 0, 10), cell('8', 1, 2), cell('8', 3, 1), cell('9', 1, 4)] }
  assert.equal(filterView(v, 'all', ['all', 'all']), v)
  // 1つ目の選択駒あり（ビット0）
  const withLux = filterView(v, 'all', ['with', 'all'])
  assert.equal(withLux.participants, 7)
  assert.deepEqual(withLux.emblems, [[0, [7, 28, 0, 0, 56]]])
  assert.deepEqual(withLux.picks, [[0, 0, [7, 21, 0, 0, 56]]])
  // Lv8 かつ 2つ目の選択駒なし
  const v8 = filterView(v, '8', ['all', 'without'])
  assert.equal(v8.participants, 12)
  assert.deepEqual(v8.traits, [[0, 2, [12, 48, 0, 0, 96], [0, 0, 0, 0, 0], [12, 48, 0, 0, 96]]])
  // 元のビューは書き換えない
  assert.deepEqual(v.cells![0].emblems, [[0, [10, 40, 0, 0, 80]]])
  const rows = pickRows(file, withLux, 0, 'ja')
  assert.deepEqual(rows.map((r) => [r.name, r.n, r.avg]), [['アルファ', 7, 3]])
})

test('filterView: 区分の無い古いファイルはレベルだけで絞る', () => {
  const lv = { lv: '8' as const, participants: 3, emblems: [], noEmblem: [3, 9, 0, 0, 24] as [number, number, number, number, number], traits: [] }
  const v: WireSummaryView = { ...view, levels: [lv] }
  assert.equal(filterView(v, '8', []).participants, 3)
  assert.equal(filterView(v, '9', []), v)
})
