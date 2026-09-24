// 統計ページの掘り下げ（public/data/drill-<ビュー>.json）の集計。純関数。
//
// 特性の段（summary.json の特性行）ごとに、同じ盤面で一番深く発動している別の特性（相方）で
// 「構成の型」に分け、型ごとの成績・最頻の盤面・駒ごとの星3率を数える。
// 例: ブラックソーン4 ＋ラヴィジャー / ＋スペルウィーバー / ＋エクセキューショナー。

import type { StaticData } from './cdragon.ts'
import type {
  ParticipantRecord,
  WireDrillFile,
  WireDrillRow,
  WireDrillType,
  WireDrillUnit,
  WireRecordStat,
} from '../shared/types.ts'
import { classifyEmblems, tierOfCount } from './aggregate-core.ts'
import { addStat, emptyStat, traitTierEntries, uniqueTraitApis } from './summary-core.ts'

/** 1つの特性行・分割に出す型の数。後ろはまとめ行（p = -2）に寄せる。 */
export const DRILL_TYPE_LIMIT = 12
/** 型の中で、この割合以上が採用している駒だけを出す。 */
export const DRILL_UNIT_SHARE = 0.1
export const DRILL_UNIT_LIMIT = 12
/** 最頻盤面の候補数（Space-Saving）。多い盤面ほど正確で、それ以外は近似。 */
const BOARD_SLOTS = 12

interface BoardSlot {
  /** Space-Saving の推定回数（追い出された回数ぶん多めに出る） */
  c: number
  /** 候補に入ってからの実人数と順位合計 */
  n: number
  place: number
}

interface TypeAcc {
  s: WireRecordStat
  /** unitIdx → [採用人数, 星3人数, 星3の順位合計, 星3以外の順位合計] */
  units: Map<number, [number, number, number, number]>
  boards: Map<string, BoardSlot>
}

function newType(): TypeAcc {
  return { s: emptyStat(), units: new Map(), boards: new Map() }
}

function addBoard(boards: Map<string, BoardSlot>, key: string, place: number): void {
  const hit = boards.get(key)
  if (hit) {
    hit.c++
    hit.n++
    hit.place += place
    return
  }
  if (boards.size < BOARD_SLOTS) {
    boards.set(key, { c: 1, n: 1, place })
    return
  }
  let minKey = ''
  let minC = Infinity
  for (const [k, v] of boards) {
    if (v.c < minC) {
      minC = v.c
      minKey = k
    }
  }
  boards.delete(minKey)
  boards.set(key, { c: minC + 1, n: 1, place })
}

/**
 * 相方特性: 自分以外で段のある特性のうち、段の深さ → 発動数 → 静的データの並び の順で最大のもの。
 * 固有特性（持つチャンピオンが1体だけ、uniqueTraitApis）は型の名前にならないので相方にしない。
 */
export function partnerOf(
  rec: ParticipantRecord,
  self: string,
  staticData: StaticData,
  traitIdx: ReadonlyMap<string, number>,
  unique: ReadonlySet<string>,
): number {
  const tc = rec.tc
  if (!tc) return -1
  let best = -1
  let bestTier = 0
  let bestCount = 0
  for (const t of Object.keys(rec.t)) {
    if (t === self) continue
    const info = staticData.traits.get(t)
    const count = tc[t]
    if (!info || unique.has(t) || count === undefined) continue
    const tier = tierOfCount(info.tiers, count)
    if (tier === 0) continue
    const idx = traitIdx.get(t)!
    if (tier > bestTier || (tier === bestTier && (count > bestCount || (count === bestCount && idx < best)))) {
      best = idx
      bestTier = tier
      bestCount = count
    }
  }
  return best
}

export interface DrillBuilder {
  add(rec: ParticipantRecord): void
  finish(key: string, generatedAt: string): WireDrillFile
}

export function createDrillBuilder(staticData: StaticData): DrillBuilder {
  const traitIdx = new Map([...staticData.traits.keys()].map((api, i) => [api, i]))
  const unitIdx = new Map([...staticData.units.keys()].map((api, i) => [api, i]))
  const unique = uniqueTraitApis(staticData)
  // `${traitIdx}|${min}` → [全体, 紋章あり, 紋章なし] の 相方idx → 型
  type Types = Map<number, TypeAcc>
  const rows = new Map<string, { t: number; m: number; sp: [Types, Types, Types] }>()

  function addType(
    types: Types,
    partner: number,
    rec: ParticipantRecord,
    units: number[],
    stars: (number | undefined)[],
    boardKey: string,
  ): void {
    let acc = types.get(partner)
    if (!acc) types.set(partner, (acc = newType()))
    addStat(acc.s, rec)
    for (let i = 0; i < units.length; i++) {
      const u = units[i]
      let a = acc.units.get(u)
      if (!a) acc.units.set(u, (a = [0, 0, 0, 0]))
      a[0]++
      // 星の記録が無い旧レコードは星3以外に数える（星3率は下振れするが、平均は人数と合う）。
      if (stars[i] === 3) {
        a[1]++
        a[2] += rec.p
      } else a[3] += rec.p
    }
    if (boardKey) addBoard(acc.boards, boardKey, rec.p)
  }

  return {
    add(rec) {
      if (!rec.tc) return
      const { activeEmblemApis } = classifyEmblems(rec, staticData)
      const entries = traitTierEntries(rec, staticData, activeEmblemApis)
      if (entries.length === 0) return
      // 同じ駒を2体置いた盤面でも採用は1人と数える（星は高い方）。
      const starByUnit = new Map<number, number | undefined>()
      rec.u.forEach((api, i) => {
        const u = unitIdx.get(api)
        if (u === undefined) return
        const star = rec.us?.[i]
        const prev = starByUnit.get(u)
        starByUnit.set(u, prev === undefined || (star !== undefined && star > prev) ? star : prev)
      })
      const units = [...starByUnit.keys()].sort((a, b) => a - b)
      const stars = units.map((u) => starByUnit.get(u))
      const boardKey = units.join(',')
      for (const e of entries) {
        const ti = traitIdx.get(e.api)!
        const key = `${ti}|${e.min}`
        let row = rows.get(key)
        if (!row) rows.set(key, (row = { t: ti, m: e.min, sp: [new Map(), new Map(), new Map()] }))
        const partner = partnerOf(rec, e.api, staticData, traitIdx, unique)
        addType(row.sp[0], partner, rec, units, stars, boardKey)
        if (e.split === 'with') addType(row.sp[1], partner, rec, units, stars, boardKey)
        else if (e.split === 'without') addType(row.sp[2], partner, rec, units, stars, boardKey)
      }
    },
    finish(key, generatedAt) {
      const unitApis = [...staticData.units.keys()]
      const used = new Set<number>()
      const outRows: WireDrillRow[] = [...rows.values()]
        .sort((a, b) => a.t - b.t || a.m - b.m)
        .map((row) => ({
          t: row.t,
          m: row.m,
          sp: row.sp.map((types) => finishTypes(types, used)) as WireDrillRow['sp'],
        }))
      // 使われた駒だけを辞書に残し、idx を詰め直す。
      const remap = new Map([...used].sort((a, b) => a - b).map((u, i) => [u, i]))
      for (const row of outRows) {
        for (const types of row.sp) {
          for (const ty of types) {
            ty.b = ty.b.map((u) => remap.get(u)!)
            for (const u of ty.u) u[0] = remap.get(u[0])!
          }
        }
      }
      const units = [...remap.keys()].map((u) => {
        const api = unitApis[u]
        const info = staticData.units.get(api)!
        return { api, name: info.name, nameJa: info.nameJa, cost: info.cost, icon: info.icon }
      })
      for (const row of outRows) {
        for (const types of row.sp) {
          for (const ty of types) {
            ty.b.sort((a, b) => units[a].cost - units[b].cost || (units[a].name < units[b].name ? -1 : 1))
          }
        }
      }
      return { schemaVersion: 1, generatedAt, key, traits: [...staticData.traits.keys()], units, rows: outRows }
    },
  }
}

function finishTypes(types: Map<number, TypeAcc>, used: Set<number>): WireDrillType[] {
  const sorted = [...types.entries()].sort((a, b) => b[1].s[0] - a[1].s[0] || a[0] - b[0])
  const out: WireDrillType[] = []
  const rest = emptyStat()
  sorted.forEach(([p, acc], i) => {
    if (i >= DRILL_TYPE_LIMIT) {
      for (let k = 0; k < 5; k++) rest[k] += acc.s[k]
      return
    }
    const n = acc.s[0]
    const units: WireDrillUnit[] = [...acc.units.entries()]
      .filter(([, a]) => a[0] >= n * DRILL_UNIT_SHARE)
      .sort((a, b) => b[1][0] - a[1][0] || a[0] - b[0])
      .slice(0, DRILL_UNIT_LIMIT)
      .map(([u, a]) => [u, a[0], a[1], a[2], a[3]])
    let best: [string, BoardSlot] | null = null
    for (const e of acc.boards) if (!best || e[1].n > best[1].n) best = e
    const board = best ? best[0].split(',').map(Number) : []
    for (const u of units) used.add(u[0])
    for (const u of board) used.add(u)
    out.push({ p, s: acc.s, b: board, bs: best ? [best[1].n, best[1].place] : [0, 0], u: units })
  })
  if (rest[0] > 0) out.push({ p: -2, s: rest, b: [], bs: [0, 0], u: [] })
  return out
}
