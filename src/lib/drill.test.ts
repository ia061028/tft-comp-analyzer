import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WireDrillFile, WireDrillLevelsFile, WireSummaryFile } from '../../shared/types'
import { drillTypes, withDrillLevels } from './drill'

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
          {
            p: 1,
            s: [8, 24, 5, 2, 68],
            b: [0, 1],
            bs: [4, 10],
            bl: [['8', [0], 3, 6], ['9', [0, 1], 4, 10]],
            u: [[1, 8, 6, 15, 12], [0, 4, 0, 0, 14]],
          },
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

test('drillTypes: 内訳の無い古いファイルは、レベルを選ぶと型を平均Lvでふるい分け、盤面はそのレベルのものを出す', () => {
  // 型の平均Lv: 相方ブラボー 8.5（区分9）、相方なし 8.0（区分8）
  const lv9 = drillTypes(drill, summary, 'A', 4, 'all', 'ja', '9')
  assert.equal(lv9.length, 1)
  assert.deepEqual(lv9[0].board.map((u) => u.name), ['アン', 'ボブ'])
  assert.equal(lv9[0].boardN, 4)
  // 割合の母数は全型のまま
  assert.equal(lv9[0].share, 80)
  // レベル別の盤面が無い型（古いファイル）は全員の盤面
  const [solo] = drillTypes(drill, summary, 'A', 4, 'all', 'ja', '8')
  assert.equal(solo.partner, undefined)
  assert.deepEqual(solo.board.map((u) => u.name), ['アン'])
  assert.equal(solo.boardN, 2)
})

test('drillTypes: レベル別の盤面があってもその区分に人が居なければ盤面は出さない', () => {
  const only = structuredClone(drill)
  only.rows[0].sp[0][0].bl = [['9', [0, 1], 4, 10]]
  only.rows[0].sp[0][0].s[4] = 64 // 平均Lv 8.0
  const [ty] = drillTypes(only, summary, 'A', 4, 'all', 'ja', '8')
  assert.deepEqual(ty.board, [])
})

test('drillTypes: レベル別の内訳があれば、型の数字・駒・盤面をそのレベルのプレイヤーだけで出す', () => {
  const lv = structuredClone(drill)
  const [bravo, solo] = lv.rows[0].sp[0]
  // ブラボー型: Lv8 は1人で Ann だけ、Lv9 は7人で Bob を採用（全体の駒には Bob が居る）
  bravo.l = [
    { k: '8', s: [1, 5, 0, 0, 8], b: [0], bs: [1, 5], u: [[0, 1, 0, 0, 5]] },
    { k: '9', s: [7, 19, 5, 2, 60], b: [0, 1], bs: [4, 10], u: [[1, 7, 6, 15, 4]] },
  ]
  solo.l = [{ k: '8', s: [2, 14, 0, 0, 16], b: [0], bs: [2, 14], u: [[0, 2, 0, 0, 14]] }]
  // まとめ行は人数だけ
  lv.rows[0].sp[2][0].l = [{ k: '8', s: [3, 12, 1, 0, 24], b: [], bs: [0, 0], u: [] }]

  const lv8 = drillTypes(lv, summary, 'A', 4, 'all', 'ja', '8')
  // 人数の多い順（相方なし 2人 → ブラボー 1人）。割合の母数はこのレベルの人数
  assert.deepEqual(lv8.map((ty) => [ty.partner?.name, ty.n, ty.share.toFixed(1)]), [
    [undefined, 2, '66.7'],
    ['ブラボー', 1, '33.3'],
  ])
  const b8 = lv8[1]
  assert.equal(b8.avg, 5)
  assert.equal(b8.lv, 8)
  assert.deepEqual(b8.board.map((u) => u.name), ['アン'])
  // 盤面に居ない Bob（Lv9 だけが採用）は駒の一覧にも出ない
  assert.deepEqual(b8.units.map((u) => [u.name, u.share]), [['アン', 100]])

  // その区分に人が居ない型は出さない
  const lv9 = drillTypes(lv, summary, 'A', 4, 'all', 'ja', '9')
  assert.deepEqual(lv9.map((ty) => ty.partner?.name), ['ブラボー'])
  assert.equal(lv9[0].share, 100)
  assert.deepEqual(drillTypes(lv, summary, 'A', 4, 'all', 'ja', '10'), [])

  const [rest] = drillTypes(lv, summary, 'A', 4, 'without', 'ja', '8')
  assert.equal(rest.partner, null)
  assert.equal(rest.n, 3)
})

test('withDrillLevels: 同じ集計回の内訳だけを型に付ける', () => {
  const levels: WireDrillLevelsFile = {
    schemaVersion: 1,
    generatedAt: drill.generatedAt,
    key: drill.key,
    rows: [
      {
        t: 0,
        m: 4,
        sp: [
          [[{ k: '8', s: [1, 5, 0, 0, 8], b: [0], bs: [1, 5], u: [] }], []],
          [],
          [[]],
        ],
      },
    ],
  }
  const merged = withDrillLevels(drill, levels)
  assert.equal(merged.rows[0].sp[0][0].l![0].k, '8')
  assert.deepEqual(merged.rows[0].sp[0][1].l, [])
  // 集計回が違えば付けない
  assert.equal(withDrillLevels(drill, { ...levels, generatedAt: 'other' }), drill)
  // 型の数が合わなければ付けない
  assert.equal(withDrillLevels(drill, { ...levels, rows: [{ ...levels.rows[0], sp: [[], [], [[]]] }] }), drill)
})
