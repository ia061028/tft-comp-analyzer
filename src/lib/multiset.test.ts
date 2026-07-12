import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemSig } from '../../shared/types'
import { compUsages } from './multiset'

/** sigs だけ持つ最小の CompStats を作る（compUsages は sigs のみ参照）。 */
function comp(sigs: EmblemSig[]): CompStats {
  return {
    units: [],
    n: 0,
    unitStars: [],
    unitItems: [],
    holders: [],
    sigs,
  }
}

const sig = (
  one: number[],
  half: number[],
  n: number,
  top4: number,
  win: number,
  p: number,
): EmblemSig => ({ one, half, n, top4, win, p })

// 紋章3(ブローラー)が +1 の行、+0.5 の行、紋章7(ミィプル)が +1 ＋ 3 が +0.5 の行。
const c = comp([
  sig([3], [], 10, 6, 2, 40), // Brawler ちょうど(+1)
  sig([], [3], 5, 2, 0, 25), // Brawler 余り(+0.5) のみ
  sig([7], [3], 4, 3, 1, 14), // Meeple +1 ＋ Brawler +0.5
])

test('compUsages: 活用の仕方ごとに行が分かれ、各行の指標はその行のレコードのみ', () => {
  // sel=[3]: 行1 は +1、行2・行3 は +0.5。→ X=1 の行と X=0.5 の行の2本。
  const rows = compUsages(c, [3])
  assert.equal(rows.length, 2)

  const [full, half] = rows // X 降順
  assert.equal(full.x, 1)
  assert.equal(full.adopt, 10)
  assert.equal(full.top4, 6)
  assert.equal(full.win, 2)
  assert.equal(full.p, 40)
  assert.equal(full.n, 1)

  assert.equal(half.x, 0.5)
  assert.equal(half.adopt, 9) // 5 + 4
  assert.equal(half.top4, 5) // 2 + 3
  assert.equal(half.win, 1) // 0 + 1
  assert.equal(half.p, 39) // 25 + 14
})

test('compUsages: X は同一レコード内で同時に達成された活用度（別レコードから最良値を寄せ集めない）', () => {
  // sel=[7,3]: 3 と 7 が「同時に +1」になったレコードは1件も無い。
  // 旧実装は紋章ごとに最良値を拾って合計し X=2 としていたが、実在しないので最大は 1.5。
  const rows = compUsages(c, [7, 3])
  assert.deepEqual(
    rows.map((r) => [r.x, r.adopt]),
    [
      [1.5, 4], // 行3: 7が+1、3が+0.5
      [1, 10], // 行1: 3が+1のみ
      [0.5, 5], // 行2: 3が+0.5のみ
    ],
  )
  assert.equal(rows[0].n, 2) // N は選択総数
})

test('compUsages: X が同じでも紋章の内訳が違えば別行', () => {
  const c2 = comp([sig([3], [], 10, 5, 2, 40), sig([7], [], 8, 4, 1, 32)])
  const rows = compUsages(c2, [3, 7])
  assert.equal(rows.length, 2) // どちらも X=1 だが「3を活用」と「7を活用」で別の構成
  assert.deepEqual(rows.map((r) => r.x).sort(), [1, 1])
  const keys = new Set(rows.map((r) => r.key))
  assert.equal(keys.size, 2)
  const byAdopt = rows.slice().sort((a, b) => b.adopt - a.adopt)
  assert.equal(byAdopt[0].best.get(3), 1)
  assert.equal(byAdopt[0].best.get(7), 0)
  assert.equal(byAdopt[1].best.get(7), 1)
  assert.equal(byAdopt[1].best.get(3), 0)
})

test('compUsages: +0.5のみ（一度も+1にならない紋章）でも該当し X=0.5', () => {
  // half にしか現れない紋章 99。発動はしている（余りあり）ので対象。
  const only = comp([sig([], [99], 8, 3, 0, 40)])
  const rows = compUsages(only, [99])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].x, 0.5)
  assert.equal(rows[0].adopt, 8)
  assert.equal(rows[0].top4, 3)
})

test('compUsages: どの行にも現れない紋章のみの選択は空', () => {
  assert.deepEqual(compUsages(c, [42]), [])
})

test('compUsages: 同一紋章×2 は個数を加算（N=2）し、2体活用と1体活用で行が分かれる', () => {
  const c2 = comp([sig([3, 3], [], 6, 3, 1, 20), sig([3], [], 10, 5, 2, 40)])
  const rows = compUsages(c2, [3, 3])
  assert.deepEqual(
    rows.map((r) => [r.x, r.adopt]),
    [
      [2, 6], // 2枚とも活用
      [1, 10], // 1枚だけ活用
    ],
  )
  assert.equal(rows[0].n, 2)
})

test('compUsages: 同一紋章×2 だが1体しか+1にならない構成は X=1（1/2相当）の1行のみ', () => {
  const c3 = comp([sig([3], [], 10, 5, 2, 40)])
  const rows = compUsages(c3, [3, 3])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].x, 1) // min(2,1)=1
  assert.equal(rows[0].n, 2)
})

test('compUsages: 選択なしは空', () => {
  assert.deepEqual(compUsages(c, []), [])
})
