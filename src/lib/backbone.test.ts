import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats, EmblemInfo, TraitInfo, UnitInfo } from '../../shared/types'
import { buildTree, type Row, MIN_BACKBONE, MAX_DIFF } from './backbone'
import { activeTraitCounts } from './format'

/** 盤面 units だけを持つ最小の Row（クラスタリングは盤面のユニット集合しか見ない）。 */
const row = (
  units: number[],
  n = 50,
  used: number[] = [0],
  stats?: { top4: number; win: number; place: number },
): Row => {
  const comp: CompStats = {
    units,
    n,
    unitStars: units.map(() => 2),
    unitItems: [],
    holders: [],
    sigs: [],
  }
  const s = stats ?? { top4: 0.8, win: 0.3, place: 3 }
  return {
    comp,
    row: { used, match: used.length, n, top4: n * s.top4, win: n * s.win, p: n * s.place },
    traitCount: new Map(),
    bronze: 0,
  }
}

const CORE = [1, 2, 3, 4, 5, 6, 7, 8] // 背骨候補（8体）

test('背骨が取れる系統はツリーになり、派生は「差分だけ」を持つ', () => {
  const sorted = [
    row([...CORE, 9]), // +9
    row([...CORE, 10]), // +10
    row([...CORE, 11]), // +11
    row([...CORE, 9, 10]), // +9,10（9体→10体）
  ]
  const { families, flat } = buildTree(sorted)

  assert.equal(families.length, 1, '1系統にまとまる')
  assert.equal(flat.length, 0, 'フラットに落ちる行は無い')

  const f = families[0]
  assert.deepEqual(f.backbone.slice().sort((a, b) => a - b), CORE, '背骨 = 共通8体')

  // 体数グループは降順（10体 → 9体）
  assert.deepEqual(f.groups.map((g) => g.units), [10, 9])

  const nine = f.groups.find((g) => g.units === 9)!
  assert.equal(nine.derivs.length, 3)
  assert.deepEqual(nine.derivs.map((d) => d.adds), [[9], [10], [11]], '各派生は +1体だけ')
  assert.ok(nine.derivs.every((d) => d.removes.length === 0), '欠落なし')

  const ten = f.groups.find((g) => g.units === 10)!
  assert.deepEqual(ten.derivs[0].adds, [9, 10], '10体は +2体')
})

test('背骨にあるユニットが盤面に無ければ removes（欠落）になる', () => {
  const sorted = [
    row([...CORE, 9]),
    row([...CORE, 10]),
    row([...CORE, 11]),
    row([1, 2, 3, 4, 5, 6, 7, 12]), // 8 が欠け、12 が入る
  ]
  const { families } = buildTree(sorted)
  assert.equal(families.length, 1)
  const all = families[0].groups.flatMap((g) => g.derivs)
  const withMissing = all.find((d) => d.removes.length > 0)
  assert.ok(withMissing, '欠落を持つ派生がある')
  assert.deepEqual(withMissing!.removes, [8])
  assert.deepEqual(withMissing!.adds, [12])
})

test('完全連結クラスタリングは連鎖崩壊しない（A≈B, B≈C だが A≉C を1束にしない）', () => {
  // 貪欲（単連結）なら A-B-C が鎖でつながって1束になり、共通部分が消える。
  // 完全連結は A と C が遠いことを見るので、別系統に割れる。
  const A = [1, 2, 3, 4, 5, 6, 7, 8]
  const B = [1, 2, 3, 4, 9, 10, 11, 12] // A と半分共通
  const C = [9, 10, 11, 12, 13, 14, 15, 16] // B と半分共通、A とは共通ゼロ
  const sorted = [
    row(A),
    row([...A.slice(0, 7), 20]),
    row(B),
    row([...B.slice(0, 7), 21]),
    row(C),
    row([...C.slice(0, 7), 22]),
  ]
  const { families } = buildTree(sorted)

  // A系・B系・C系がそれぞれ独立した系統になり、背骨が残っていること。
  assert.ok(families.length >= 2, `連鎖せず複数系統に割れる (実際 ${families.length})`)
  for (const f of families) {
    assert.ok(
      f.backbone.length >= MIN_BACKBONE,
      `どの系統も背骨が ${MIN_BACKBONE} 体以上ある (実際 ${f.backbone.length})`,
    )
  }
  // A の背骨に C のユニットが混ざっていない（＝連鎖していない証拠）
  const withOne = families.find((f) => f.backbone.includes(1))!
  assert.ok(!withOne.backbone.some((u) => [13, 14, 15, 16].includes(u)))
})

test('背骨が MIN_BACKBONE 未満の系統はフラット縮退する', () => {
  // 5体しか共通しない（＝背骨 5 < 6）ので、ツリーにしない。
  const sorted = [
    row([1, 2, 3, 4, 5, 30, 31, 32]),
    row([1, 2, 3, 4, 5, 33, 34, 35]),
    row([1, 2, 3, 4, 5, 36, 37, 38]),
  ]
  const { families, flat } = buildTree(sorted)
  assert.equal(families.length, 0, 'ツリーにしない')
  assert.equal(flat.length, 3, '全行がフラットに落ちる')
})

test('差分が MAX_DIFF を超える行だけがフラットに落ち、同系統の他の行はツリーに残る', () => {
  const sorted = [
    row([...CORE, 9]),
    row([...CORE, 10]),
    row([...CORE, 11]),
    row([...CORE, 12]),
    // 背骨に近いが差分が大きい行（+4体）。クラスタは同じでも、この行だけ縮退させたい。
    row([1, 2, 3, 4, 5, 6, 40, 41, 42, 43]),
  ]
  const { families, flat } = buildTree(sorted)
  assert.equal(families.length, 1)
  const derivs = families[0].groups.flatMap((g) => g.derivs)
  assert.ok(
    derivs.every((d) => d.adds.length + d.removes.length <= MAX_DIFF),
    'ツリーに残った派生はすべて差分 <= MAX_DIFF',
  )
  assert.equal(flat.length, 1, '差分の大きい1行だけがフラットに落ちる')
  assert.deepEqual(flat[0].comp.units, [1, 2, 3, 4, 5, 6, 40, 41, 42, 43])
})

test('1行だけの系統はフラット縮退する（背骨＋派生ゼロは無意味）', () => {
  const sorted = [
    row([...CORE, 9]),
    row([...CORE, 10]),
    row([...CORE, 11]),
    row([50, 51, 52, 53, 54, 55, 56, 57]), // どの系統とも遠い孤立行
  ]
  const { families, flat } = buildTree(sorted)
  assert.equal(families.length, 1)
  assert.equal(flat.length, 1)
  assert.deepEqual(flat[0].comp.units, [50, 51, 52, 53, 54, 55, 56, 57])
})

test('系統は最良の派生が良い順、flat は元の並び順を保つ', () => {
  const sorted = [
    row([20, 21, 22, 23, 24, 25, 26, 27]), // 0: 孤立（最良）→ flat
    row([...CORE, 9]), // 1: 系統X の最良
    row([...CORE, 10]), // 2
    row([30, 31, 32, 33, 34, 35, 36, 9]), // 3: 系統Y の最良
    row([30, 31, 32, 33, 34, 35, 36, 10]), // 4
    row([60, 61, 62, 63, 64, 65, 66, 67]), // 5: 孤立 → flat
  ]
  const { families, flat } = buildTree(sorted)
  assert.equal(families.length, 2)
  assert.ok(families[0].rank < families[1].rank, '系統は最良行の順位で並ぶ')
  assert.deepEqual(families[0].backbone.slice().sort((a, b) => a - b), CORE, '先に来るのは系統X')
  assert.deepEqual(
    flat.map((r) => r.comp.units[0]),
    [20, 60],
    'flat は元の並び順',
  )
})

test('行が MIN_FAMILY 未満なら全部フラット（ツリーを強制しない）', () => {
  const { families, flat } = buildTree([row([...CORE, 9])])
  assert.equal(families.length, 0)
  assert.equal(flat.length, 1)
})

test('mixedEmblems: 系統内で紋章の使い方が割れていれば true（差分が同じ行を区別するため）', () => {
  // 同じ盤面・同じ差分でも「紋章1枚だけ使う」と「2枚とも使う」は別の行になる。
  // 画面上まったく同じに見えてしまうので、派生ごとに使用紋章を出す必要がある。
  const same = [row([...CORE, 9], 50, [0]), row([...CORE, 10], 50, [0]), row([...CORE, 11], 50, [0])]
  assert.equal(buildTree(same).families[0].mixedEmblems, false, '全行が同じ紋章の使い方')

  const mixed = [
    row([...CORE, 9], 50, [0, 1]), // 2枚とも使う
    row([...CORE, 9], 40, [0]), // 同じ盤面だが1枚しか使わない
    row([...CORE, 10], 50, [0, 1]),
  ]
  assert.equal(buildTree(mixed).families[0].mixedEmblems, true, '使い方が割れている')
})

// --- 体数グループの統計サマリ（最小・中央値・最大） ---

test('統計サマリは「同じ体数のグループの中だけ」で集計する（体数をまたがない）', () => {
  // 9体3件（平均 2.0 / 3.0 / 4.0）と 10体1件（平均 1.0）。
  // 系統全体で集計すると 1.0〜4.0 になるが、これは生存バイアス。9体は 2.0〜4.0 でなければならない。
  const sorted = [
    row([...CORE, 20], 50, [0], { top4: 1.0, win: 0.5, place: 1.0 }), // 9体
    row([...CORE, 9], 50, [0], { top4: 0.9, win: 0.4, place: 2.0 }),
    row([...CORE, 10], 50, [0], { top4: 0.8, win: 0.3, place: 3.0 }),
    row([...CORE, 11], 50, [0], { top4: 0.5, win: 0.1, place: 4.0 }),
    row([...CORE, 30, 31], 50, [0], { top4: 1.0, win: 0.7, place: 1.0 }), // 10体
  ]
  const { families } = buildTree(sorted)
  assert.equal(families.length, 1)

  const nine = families[0].groups.find((g) => g.units === 9)!
  assert.equal(nine.derivs.length, 4)
  assert.equal(nine.place.min, 1.0)
  assert.equal(nine.place.max, 4.0)
  assert.equal(nine.place.median, 2.5, '4件の中央値は中央2つ(2.0,3.0)の平均')

  const ten = families[0].groups.find((g) => g.units === 10)!
  assert.equal(ten.derivs.length, 1)
  assert.equal(ten.place.min, 1.0)
  assert.equal(ten.place.max, 1.0)
  assert.equal(ten.place.median, 1.0, '1件なら min=median=max')

  // 10体の 1.0 が 9体グループの幅に混ざっていないこと（＝体数をまたいでいない）。
  assert.ok(nine.place.max === 4.0 && ten.place.max === 1.0)
})

test('統計サマリ: Top4率・1位率も % で集計される', () => {
  const sorted = [
    row([...CORE, 9], 100, [0], { top4: 1.0, win: 0.5, place: 2.0 }),
    row([...CORE, 10], 100, [0], { top4: 0.6, win: 0.1, place: 3.0 }),
    row([...CORE, 11], 100, [0], { top4: 0.8, win: 0.3, place: 2.5 }),
  ]
  const g = buildTree(sorted).families[0].groups[0]
  assert.equal(g.top4.min, 60)
  assert.equal(g.top4.max, 100)
  assert.equal(g.top4.median, 80)
  assert.equal(g.win.min, 10)
  assert.equal(g.win.max, 50)
  assert.equal(g.win.median, 30)
})

// --- 派生のシナジー（コアから伸びる特性） ---

const T: TraitInfo[] = [
  // 0: 2/4/6 段。CORE は 2 体持ち（＝コアで既に発動中）
  { api: 'A', name: 'A', nameJa: 'A', icon: '', tiers: [[2, 1], [4, 3], [6, 5]] },
  // 1: 2/4 段。CORE は 1 体持ち（＝コアでは未発動）
  { api: 'B', name: 'B', nameJa: 'B', icon: '', tiers: [[2, 1], [4, 3]] },
]
const U: UnitInfo[] = Array.from({ length: 32 }, (_, i) => ({
  api: `u${i}`, name: `u${i}`, nameJa: `u${i}`, cost: 1, icon: '', code: 0,
  traits: i === 1 || i === 2 ? [0] : i === 3 ? [1] : i === 9 ? [1] : i === 10 ? [0] : [],
}))
const E: EmblemInfo[] = [{ api: 'e', name: 'e', nameJa: 'e', trait: 0, icon: '', base: 'none' }]

test('シナジー: コアから発動段が上がる／新たに発動する特性だけを出す', () => {
  // CORE = [1..8]: trait0 を u1,u2 が持つ（2体）＋ 紋章 e(→trait0) で 3体 → A は 2段目未満、1段目発動中。
  //                trait1 を u3 が持つ（1体）→ B は未発動。
  const mk = (extra: number) => row([...CORE, extra])
  const withCounts = (r: Row) => ({ ...r, traitCount: activeTraitCounts(r.comp, r.row.used, U, E) })

  const sorted = [
    withCounts(mk(9)), // +u9: trait1 が 2体 → B が新たに発動
    withCounts(mk(10)), // +u10: trait0 が 4体 → A が 2段目に上がる
    withCounts(mk(11)), // +u11: 特性なし → 伸びる特性なし
  ]
  const { families } = buildTree(sorted, U, E, T)
  assert.equal(families.length, 1)

  const byAdd = new Map(
    families[0].groups.flatMap((g) => g.derivs).map((d) => [d.adds[0], d.synergy]),
  )

  assert.deepEqual(
    byAdd.get(9)!.map(([ti, , min]) => [ti, min]),
    [[1, 2]],
    '+u9 は B が新たに 2 段で発動',
  )
  assert.deepEqual(
    byAdd.get(10)!.map(([ti, , min]) => [ti, min]),
    [[0, 4]],
    '+u10 は A が 4 段へ上がる（既に発動中でも段が上がれば出す）',
  )
  assert.deepEqual(byAdd.get(11), [], '+u11 は何も伸びない')
})

test('列は体数ぶんに詰まり、共通駒が左にそろう', () => {
  const sorted = [
    row([...CORE, 9]),
    row([...CORE, 10]),
    row([...CORE, 11]),
    row([...CORE, 9, 10]),
  ]
  const f = buildTree(sorted).families[0]

  const nine = f.groups.find((g) => g.units === 9)!
  assert.equal(nine.lanes.length, 9, '9体グループの列は9本（21本の和集合にしない）')
  assert.deepEqual(
    nine.lanes.map((l) => l.fixed),
    [...CORE, null],
    '背骨8体が左に固定、9/10/11 は右端の1列を共有する',
  )
  assert.deepEqual(
    nine.derivs.map((d) => d.slots),
    [
      [...CORE, 9],
      [...CORE, 10],
      [...CORE, 11],
    ],
    '同居しない駒は同じ列に詰まるので、空きマスが出ない',
  )

  const ten = f.groups.find((g) => g.units === 10)!
  // 派生1件なので、その盤面にある駒はすべて共通駒になる。
  assert.deepEqual(ten.lanes.map((l) => l.fixed), [...CORE, 9, 10])
  assert.deepEqual(ten.derivs[0].slots, [...CORE, 9, 10])
})

test('共通でない駒も、そろえられるものは同じ列にそろう', () => {
  // 8体 ＝ 共通5体 ＋ 残り3体。A(20)・B(21) は4構成すべてに出るので共通側に回り、
  // C/D/E/F は1構成ずつなので同居しない ＝ 1列を共有できる。
  const base = [1, 2, 3, 4, 5]
  const sorted = [
    row([...base, 20, 21, 30]),
    row([...base, 20, 21, 31]),
    row([...base, 20, 21, 32]),
    row([...base, 20, 21, 33]),
  ]
  const g = buildTree(sorted).families[0].groups.find((x) => x.units === 8)!

  assert.equal(g.lanes.length, 8, '列は体数ぶん。空き列を作らない')
  assert.equal(g.lanes.filter((l) => l.fixed !== null).length, 7, '共通は 5 + A,B の7体')
  assert.equal(g.lanes[7].fixed, null, '残り1列だけが選ぶ枠')

  // 共通駒の横位置は全構成で同じ。ここが「並びだけで共通と分かる」の実体。
  const heads = g.derivs.map((d) => d.slots.slice(0, 7).join(','))
  assert.equal(new Set(heads).size, 1, '共通7体は全構成で同じ並び')
  assert.deepEqual(
    g.derivs.map((d) => d.slots[7]).sort((a, b) => a - b),
    [30, 31, 32, 33],
    '揃わない駒は同じ列に詰めて出す',
  )
  assert.ok(
    g.derivs.every((d) => d.slots.length === 8 && d.slots.every((u) => u >= 0)),
    '詰めた結果、空きマスは出ない',
  )
})

test('同居する駒は別の列に分かれる', () => {
  // 30 と 31 は同じ構成に同居するので同じ列に置けない。列は体数(8)ぶんで足りる。
  const base = [1, 2, 3, 4, 5, 6]
  const sorted = [
    row([...base, 30, 31]),
    row([...base, 30, 32]),
    row([...base, 31, 33]),
    row([...base, 32, 33]),
  ]
  const g = buildTree(sorted).families[0].groups.find((x) => x.units === 8)!

  assert.equal(g.lanes.length, 8)
  assert.deepEqual(g.lanes.map((l) => l.fixed), [...base, null, null])
  for (const d of g.derivs) {
    assert.equal(d.slots.length, 8)
    assert.deepEqual(d.slots.slice(0, 6), base, '共通6体は同じ横位置')
    assert.deepEqual(
      d.slots.slice(6).filter((u) => u >= 0).sort((a, b) => a - b),
      d.comp.units.slice(6).sort((a, b) => a - b),
      '選ぶ枠にその構成の残りが入る',
    )
  }
})
