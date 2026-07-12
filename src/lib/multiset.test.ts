import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemSig } from '../../shared/types'
import { compRows, maxEmblemMultiplicity } from './multiset'

/** sigs だけ持つ最小の CompStats を作る（compRows は sigs のみ参照）。 */
function comp(sigs: EmblemSig[]): CompStats {
  return { units: [], n: 0, unitStars: [], unitItems: [], holders: [], sigs }
}

/** e は活用紋章の多重集合（昇順）。 */
const sig = (e: number[], n: number, top4: number, win: number, p: number): EmblemSig => ({
  e,
  n,
  top4,
  win,
  p,
})

// 紋章3だけの行 / 紋章3と7の行 / 紋章7だけの行。
const c = comp([sig([3], 10, 6, 2, 40), sig([3, 7], 4, 3, 1, 14), sig([7], 8, 4, 1, 32)])

test('compRows: 手持ちで再現できるレコードだけを行にする', () => {
  // sel=[3]: 紋章7 も使っている行は「3しか持っていない自分には作れない」ので除外。
  const rows = compRows(c, [3])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].used, [3])
  assert.equal(rows[0].match, 1)
  assert.equal(rows[0].n, 10) // 行1のみ。行2(3と7) は落ちる
  assert.equal(rows[0].top4, 6)
  assert.equal(rows[0].win, 2)
  assert.equal(rows[0].p, 40)
})

test('compRows: シグネチャがそのまま行になる（集約は不要）', () => {
  const rows = compRows(c, [3, 7])
  assert.deepEqual(
    rows.map((r) => [r.used, r.n]),
    [
      [[3, 7], 4], // 2枚とも活用
      [[3], 10], // 3のみ
      [[7], 8], // 7のみ
    ],
  )
})

test('compRows: 返り値は一致数の降順', () => {
  const rows = compRows(c, [3, 7])
  assert.deepEqual(
    rows.map((r) => r.match),
    [2, 1, 1],
  )
})

test('compRows: 選択枚数を超えて同一紋章を使う構成は除外（作れないため）', () => {
  const c2 = comp([sig([3, 3], 6, 3, 1, 20), sig([3], 10, 5, 2, 40)])
  // 1枚しか持っていない → 2枚使う行は作れない。
  assert.deepEqual(
    compRows(c2, [3]).map((r) => [r.used, r.n]),
    [[[3], 10]],
  )
  // 2枚持っていれば両方作れる。
  assert.deepEqual(
    compRows(c2, [3, 3]).map((r) => [r.used, r.n]),
    [
      [[3, 3], 6],
      [[3], 10],
    ],
  )
})

test('compRows: 該当レコードが無ければ空配列', () => {
  const c2 = comp([sig([3, 7], 6, 3, 1, 20)]) // 常に7も併用する構成
  assert.deepEqual(compRows(c2, [3]), [])
  assert.deepEqual(compRows(c, [42]), [])
})

test('compRows: 選択なしは空', () => {
  assert.deepEqual(compRows(c, []), [])
})

test('compRows: 選択が未ソートでも正しく動く', () => {
  assert.deepEqual(compRows(c, [7, 3]), compRows(c, [3, 7]))
})

test('maxEmblemMultiplicity: 1レコード内で同時活用された最大枚数', () => {
  const comps = [
    comp([sig([3, 3], 6, 3, 1, 20), sig([3, 7], 10, 5, 2, 40)]),
    comp([sig([7], 4, 2, 0, 16)]),
  ]
  const max = maxEmblemMultiplicity(comps, 8)
  assert.equal(max[3], 2)
  assert.equal(max[7], 1)
  assert.equal(max[0], 0) // 一度も活用されていない紋章
})
