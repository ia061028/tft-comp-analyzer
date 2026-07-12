import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemSig } from '../../shared/types'
import { compUsage } from './multiset'

/** sigs だけ持つ最小の CompStats を作る（compUsage は sigs のみ参照）。 */
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

// 紋章3(ブローラー)が +1 の行、+0.5 の行、紋章7(ミィプル)が +1 の行。
const c = comp([
  sig([3], [], 10, 6, 2, 40), // Brawler ちょうど(+1)
  sig([], [3], 5, 2, 0, 25), // Brawler 余り(+0.5) のみ
  sig([7], [3], 4, 3, 1, 14), // Meeple +1 ＋ Brawler +0.5
])

test('compUsage: 発動していれば +1 でも +0.5 でも該当行として集計', () => {
  // sel=[3]: 3 が発動している行 = 行1(one,n10)・行2(half,n5)・行3(half,n4) の全て。
  const u = compUsage(c, [3])!
  assert.equal(u.adopt, 19) // 10 + 5 + 4
  assert.equal(u.top4, 11) // 6 + 2 + 3
  assert.equal(u.win, 3) // 2 + 0 + 1
  assert.equal(u.p, 79) // 40 + 25 + 14
  assert.equal(u.x, 1) // Brawler は +1 の行が存在 → best=1
  assert.equal(u.n, 1)
})

test('compUsage: +0.5のみ（一度も+1にならない紋章）でも該当し X=0.5', () => {
  // half にしか現れない紋章 99 を選択。発動はしている（余りあり）ので対象。
  const only = comp([sig([], [99], 8, 3, 0, 40)])
  const u = compUsage(only, [99])!
  assert.equal(u.adopt, 8)
  assert.equal(u.top4, 3)
  assert.equal(u.x, 0.5)
  assert.equal(u.n, 1)
})

test('compUsage: どの行にも現れない紋章のみの選択は null', () => {
  assert.equal(compUsage(c, [42]), null)
})

test('compUsage: 複数選択は「いずれかが発動」の行を抽出、Xは紋章ごと最良値の合計', () => {
  // sel=[7,3]: 3 が全行で発動、7 は行3。→ 該当行は3行すべて。
  const u = compUsage(c, [7, 3])!
  assert.equal(u.adopt, 19) // 10 + 5 + 4
  // best: 3 は行1で+1→1、7 は行3で+1→1 → X=2
  assert.equal(u.x, 2)
  assert.equal(u.n, 2)
})

test('compUsage: 該当行で+0.5止まりの紋章は0.5寄与', () => {
  // sel=[7,3] だが Brawler(3) が +1 の行を消し、+0.5 と Meeple+1 の行だけにする
  const c2 = comp([sig([7], [3], 6, 3, 1, 20)])
  const u = compUsage(c2, [7, 3])!
  // 7 は +1 → 1、3 はこの該当行で half → 0.5。X=1.5
  assert.equal(u.x, 1.5)
  assert.equal(u.adopt, 6)
})

test('compUsage: 同一紋章×2 は個数を加算（N=2）し複数活用を反映', () => {
  // one=[3,3]（2体ちょうど発動）の sig と one=[3]（1体）の sig
  const c2 = comp([sig([3, 3], [], 6, 3, 1, 20), sig([3], [], 10, 5, 2, 40)])
  const u = compUsage(c2, [3, 3])!
  assert.equal(u.n, 2) // 選択総数
  assert.equal(u.x, 2) // 2体活用できる sig があるので X=2
  assert.equal(u.adopt, 16) // 両 sig とも 3 を含むため該当
})

test('compUsage: 同一紋章×2 だが1体しか+1にならない構成は X=1（1/2相当）', () => {
  const c3 = comp([sig([3], [], 10, 5, 2, 40)])
  const u = compUsage(c3, [3, 3])!
  assert.equal(u.n, 2)
  assert.equal(u.x, 1) // min(2,1)=1
})

test('compUsage: 選択なしは null', () => {
  assert.equal(compUsage(c, []), null)
})
