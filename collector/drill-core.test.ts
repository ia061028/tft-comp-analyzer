import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StaticData } from './cdragon.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import { createDrillBuilder, DRILL_TYPE_LIMIT } from './drill-core.ts'

// TraitA [2,4] / TraitB [2,4] / TraitC [2,3] / Solo [1]（Dee だけが持つ固有特性）。紋章A は TraitA。
function makeStaticData(extraTraits = 0): StaticData {
  const traits = new Map<string, { name: string; nameJa: string; icon: string; tiers: [number, number][] }>([
    ['TraitA', { name: 'Alpha', nameJa: 'アルファ', icon: 'a.png', tiers: [[2, 1], [4, 3]] }],
    ['TraitB', { name: 'Bravo', nameJa: 'ブラボー', icon: 'b.png', tiers: [[2, 1], [4, 3]] }],
    ['TraitC', { name: 'Charlie', nameJa: 'チャーリー', icon: 'c.png', tiers: [[2, 1], [3, 3]] }],
    ['Solo', { name: 'Solo', nameJa: 'ソロ', icon: 's.png', tiers: [[1, 4]] }],
  ])
  for (let i = 0; i < extraTraits; i++) traits.set(`X${i}`, { name: `X${i}`, nameJa: `X${i}`, icon: '', tiers: [[2, 1], [4, 3]] })
  const unit = (name: string, cost: number, traits: string[] = []) => ({ name, nameJa: name, cost, icon: `${name}.png`, code: 0, traits })
  return {
    setNumber: 18,
    traits,
    units: new Map([
      ['U1', unit('Ann', 1)],
      ['U2', unit('Bob', 2)],
      ['U3', unit('Cid', 3)],
      // Solo を持つのは Dee だけ（固有特性）
      ['U4', unit('Dee', 1, ['Solo'])],
    ]),
    emblems: new Map([
      ['EmblemA', { name: 'EmblemA', nameJa: '紋章A', traitApi: 'TraitA', traitApis: ['TraitA'], icon: 'ea.png', base: 'spatula' as const }],
    ]),
    emblemAliases: new Map(),
    items: new Map(),
    baseItemIcons: { spatula: '', fryingPan: '' },
    warnings: [],
  }
}

function rec(p: Partial<ParticipantRecord>): ParticipantRecord {
  return { m: 'm1', v: '18.0', p: 1, t: {}, e: [], u: [], lv: 8, ts: 0, ...p }
}

const rowOf = (out: ReturnType<ReturnType<typeof createDrillBuilder>['finish']>, trait: string, min: number) =>
  out.rows.find((r) => out.traits[r.t] === trait && r.m === min)!

test('相方は段の深い特性。同じ段なら発動数が多い方、固有特性は相方にしない', () => {
  const b = createDrillBuilder(makeStaticData())
  // TraitA 4 の盤面: TraitB 4（段2）と TraitC 3（段2）→ 段が同じなので発動数の多い TraitB
  b.add(rec({ t: { TraitA: 3, TraitB: 3, TraitC: 3, Solo: 4 }, tc: { TraitA: 4, TraitB: 4, TraitC: 3, Solo: 1 } }))
  // TraitA 4 の盤面: TraitB 2（段1）と TraitC 3（段2）→ 段の深い TraitC
  b.add(rec({ t: { TraitA: 3, TraitB: 1, TraitC: 3 }, tc: { TraitA: 4, TraitB: 2, TraitC: 3 } }))
  // 固有特性しか無い → 相方なし（-1）
  b.add(rec({ t: { TraitA: 3, Solo: 4 }, tc: { TraitA: 4, Solo: 1 } }))
  const out = b.finish('v', 't')
  const partners = rowOf(out, 'TraitA', 4).sp[0].map((ty) => (ty.p < 0 ? ty.p : out.traits[ty.p])).sort()
  assert.deepEqual(partners, [-1, 'TraitB', 'TraitC'].sort())
})

test('分割（全体・紋章あり・紋章なし）、駒の採用と星3、最頻の盤面', () => {
  const b = createDrillBuilder(makeStaticData())
  const t = { TraitA: 3, TraitB: 1 }
  const tc = { TraitA: 4, TraitB: 2 }
  // 紋章なし 2人（同じ盤面）。U2 は1人目が星3
  b.add(rec({ p: 1, t, tc, u: ['U1', 'U2', 'U3'], us: [2, 3, 1] }))
  b.add(rec({ p: 3, t, tc, u: ['U3', 'U2', 'U1'], us: [1, 2, 2] }))
  // 紋章で TraitA 3→4（段が上がる）＝紋章あり。同じ駒を2体置いても採用は1人（星は高い方）
  b.add(rec({ p: 5, t, tc, e: ['EmblemA'], u: ['U2', 'U2', 'U4'], us: [1, 3, 1] }))
  const out = b.finish('v', 't')
  const row = rowOf(out, 'TraitA', 4)
  const [all, withE, without] = row.sp
  assert.deepEqual(all[0].s, [3, 9, 2, 1, 24])
  assert.deepEqual(withE[0].s, [1, 5, 0, 0, 8])
  assert.deepEqual(without[0].s, [2, 4, 2, 1, 16])

  const name = (u: number) => out.units[u].name
  // 全体: U2 は3人が採用、星3は2人（順位1と5）、それ以外は1人（順位3）
  const u2 = all[0].u.find((u) => name(u[0]) === 'Bob')!
  assert.deepEqual(u2.slice(1), [3, 2, 6, 3])
  // 最頻の盤面は紋章なしの2人の盤面（コスト順）
  assert.deepEqual(all[0].b.map(name), ['Ann', 'Bob', 'Cid'])
  assert.deepEqual(all[0].bs, [2, 4])
  // 辞書には使った駒だけが入る
  assert.deepEqual(out.units.map((u) => u.api).sort(), ['U1', 'U2', 'U3', 'U4'])
})

test('型の数の上限を超えた分は、まとめ行（p = -2）に寄せる', () => {
  const extra = DRILL_TYPE_LIMIT + 2
  const b = createDrillBuilder(makeStaticData(extra))
  for (let i = 0; i < extra; i++) {
    // 相方 X{i} を i+1 人ずつ（人数の多い順に並ぶ）
    for (let k = 0; k <= i; k++) b.add(rec({ p: 4, t: { TraitA: 3, [`X${i}`]: 1 }, tc: { TraitA: 4, [`X${i}`]: 2 } }))
  }
  const types = rowOf(b.finish('v', 't'), 'TraitA', 4).sp[0]
  assert.equal(types.length, DRILL_TYPE_LIMIT + 1)
  const rest = types[types.length - 1]
  assert.equal(rest.p, -2)
  // 少ない2つの型（1人と2人）がまとまる
  assert.equal(rest.s[0], 3)
  assert.deepEqual(rest.u, [])
  assert.deepEqual(rest.b, [])
})

test('枠数の区分ごとの最頻の盤面（lb）。駒がレベルより少なければ1枠多く数える', () => {
  const b = createDrillBuilder(makeStaticData())
  const t = { TraitA: 3, TraitB: 1 }
  const tc = { TraitA: 4, TraitB: 2 }
  // 2枠: 2人が U1,U2（Lv2）、1人が U3 だけで Lv2（2枠使う駒の相当）→ どれも「〜7」
  b.add(rec({ p: 2, lv: 2, t, tc, u: ['U1', 'U2'] }))
  b.add(rec({ p: 4, lv: 2, t, tc, u: ['U2', 'U1'] }))
  b.add(rec({ p: 6, lv: 2, t, tc, u: ['U3'] }))
  // Lv8 だが枠を増やして駒9体 → レベルではなく駒の数で「9」
  const nine = ['U1', 'U2', 'U3', 'U4', 'U1', 'U2', 'U3', 'U4', 'U1']
  b.add(rec({ p: 1, lv: 8, t, tc, u: nine }))
  // 駒7体で Lv8（エルダードラゴン相当）→「8」
  b.add(rec({ p: 3, lv: 8, t, tc, u: nine.slice(0, 7) }))
  const out = b.finish('v', 't')
  const [ty] = rowOf(out, 'TraitA', 4).sp[0]
  const name = (u: number) => out.units[u].name
  assert.deepEqual(
    ty.lb!.map(([lv, board, n, place]) => [lv, board.map(name), n, place]),
    [
      ['7', ['Ann', 'Bob'], 2, 6],
      ['8', ['Ann', 'Dee', 'Bob', 'Cid'], 1, 3],
      ['9', ['Ann', 'Dee', 'Bob', 'Cid'], 1, 1],
    ],
  )
})
