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
const c = comp([
  sig([3], 10, 6, 2, 40),
  sig([3, 7], 4, 3, 1, 14),
  sig([7], 8, 4, 1, 32),
])

test('compRows: 紋章の使われ方ごとに行が分かれ、各行の指標はその行のレコードのみ', () => {
  // sel=[3]: 3 を活用している行 = 行1(n10) と 行2(n4)。どちらも「3を1枚使う」なので同じ行に畳まれる。
  const rows = compRows(c, [3])
  assert.equal(rows.length, 1)
  const [r] = rows
  assert.deepEqual(r.used, [3])
  assert.equal(r.match, 1)
  assert.equal(r.n, 14) // 10 + 4
  assert.equal(r.top4, 9) // 6 + 3
  assert.equal(r.win, 3) // 2 + 1
  assert.equal(r.p, 54) // 40 + 14
})

test('compRows: 一致数は整数のみ（余りの 0.5 は存在しない）', () => {
  const rows = compRows(c, [3, 7])
  assert.deepEqual(
    rows.map((r) => [r.match, r.n]),
    [
      [2, 4], // 行2: 3と7の両方
      [1, 10], // 行1: 3のみ
      [1, 8], // 行3: 7のみ
    ],
  )
  assert.ok(rows.every((r) => Number.isInteger(r.match)))
})

test('compRows: 一致数が同じでも紋章の内訳が違えば別行', () => {
  const rows = compRows(c, [3, 7]).filter((r) => r.match === 1)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.used).sort(), [[3], [7]])
})

test('compRows: 返り値は一致数の降順', () => {
  const rows = compRows(c, [3, 7])
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].match >= rows[i].match)
})

test('compRows: 同一紋章×2 は多重集合として数え、2枚活用と1枚活用で行が分かれる', () => {
  const c2 = comp([sig([3, 3], 6, 3, 1, 20), sig([3], 10, 5, 2, 40)])
  const rows = compRows(c2, [3, 3])
  assert.deepEqual(
    rows.map((r) => [r.match, r.n]),
    [
      [2, 6], // 2枚とも活用
      [1, 10], // 1枚だけ活用
    ],
  )
})

test('compRows: 選択が1枚なら構成が2枚使っていても一致数は1（手持ち超過は extra 側）', () => {
  const c2 = comp([sig([3, 3], 6, 3, 1, 20)])
  const rows = compRows(c2, [3])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].match, 1)
  assert.equal(rows[0].extraN, 6)
  assert.deepEqual([...rows[0].extra], [[3, 6]]) // 2枚目は手持ち外
})

test('compRows: 選択外の紋章を活用したレコードは extra に計上', () => {
  const rows = compRows(c, [3])
  const r = rows[0] // 行1(n10, 3のみ) + 行2(n4, 3と7)
  assert.equal(r.extraN, 4) // 行2 のみ 7 を併用
  assert.deepEqual([...r.extra], [[7, 4]])
})

test('compRows: strict は手持ち超過を含むレコードを母数から除外', () => {
  const rows = compRows(c, [3], true)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].n, 10) // 行2(7を併用) が落ちる
  assert.equal(rows[0].extraN, 0)
})

test('compRows: strict で該当レコードが全滅すれば空配列', () => {
  const c2 = comp([sig([3, 7], 6, 3, 1, 20)]) // 常に7も併用する構成
  assert.deepEqual(compRows(c2, [3], true), [])
})

test('compRows: どの行にも現れない紋章のみの選択は空', () => {
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
