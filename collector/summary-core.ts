// 統計ページ（public/data/summary.json）の集計。純関数。
//
// 構成一覧の成績は「紋章を活用した試合」の部分集合（全参加者の約25%、平均順位 4.16）に偏るので、
// 紋章や特性そのものの強さを測る母集団にならない。ここでは盤面の完全一致も紋章の有無も問わず、
// 対象レコードを全部数える。

import type { StaticData } from './cdragon.ts'
import type {
  EmblemInfo,
  LevelKey,
  ParticipantRecord,
  TraitInfo,
  WireRecordStat,
  WireSummaryChooser,
  WireSummaryView,
} from '../shared/types.ts'
import { classifyEmblems, classifyRecord, inferTraitGrants, tierOfCount, type GranterGuess } from './aggregate-core.ts'

export const emptyStat = (): WireRecordStat => [0, 0, 0, 0, 0]

export function addStat(s: WireRecordStat, rec: ParticipantRecord): void {
  s[0]++
  s[1] += rec.p
  if (rec.p <= 4) s[2]++
  if (rec.p === 1) s[3]++
  s[4] += rec.lv
}

/** 紋章が段の計算に使った特性（変種トレイトを持つ紋章は rec.t に載っている方）。 */
function emblemTraitOf(rec: ParticipantRecord, traitApis: readonly string[]): string | undefined {
  return traitApis.find((a) => a in rec.t)
}

/** 1人の発動特性1つぶん。段の下限体数と、その特性の紋章との関係。 */
export interface TraitTierEntry {
  api: string
  min: number
  /** with = その特性の紋章が段を上げている / without = その特性の紋章を装備していない / null = 装備したが余り */
  split: 'with' | 'without' | null
}

/**
 * `rec.tc`（発動数）から、発動している特性ごとの段と紋章の有無を引く。統計の表と掘り下げの共通部品。
 * `tc` を持たない旧レコードは段が分からないので空。
 */
export function traitTierEntries(
  rec: ParticipantRecord,
  staticData: StaticData,
  activeEmblemApis: ReadonlySet<string>,
): TraitTierEntry[] {
  const tc = rec.tc
  if (!tc) return []
  // 特性 → その特性の紋章を装備しているか / 活用しているか
  const equipped = new Set<string>()
  const used = new Set<string>()
  for (const raw of rec.e) {
    const api = staticData.emblemAliases.get(raw) ?? raw
    const emb = staticData.emblems.get(api)
    if (!emb) continue
    for (const t of emb.traitApis) equipped.add(t)
    if (activeEmblemApis.has(api)) {
      const t = emblemTraitOf(rec, emb.traitApis)
      if (t !== undefined) used.add(t)
    }
  }
  const out: TraitTierEntry[] = []
  for (const t of Object.keys(rec.t)) {
    const info = staticData.traits.get(t)
    const count = tc[t]
    if (!info || count === undefined) continue
    const tier = tierOfCount(info.tiers, count)
    if (tier === 0) continue
    out.push({ api: t, min: info.tiers[tier - 1][0], split: used.has(t) ? 'with' : equipped.has(t) ? null : 'without' })
  }
  return out
}

export const LEVEL_KEYS: readonly LevelKey[] = ['7', '8', '9', '10']

/** プレイヤーレベル → 絞り込みの区分（7 以下と 10 以上はまとめる）。 */
export function levelKeyOf(lv: number): LevelKey {
  return lv <= 7 ? '7' : lv >= 10 ? '10' : lv === 8 ? '8' : '9'
}

/** 選択駒: 盤面に置くと、プレイヤーが選んだ特性を上乗せする駒。 */
export interface Chooser {
  api: string
  /** 選んだ特性1つあたりの上乗せ数。 */
  delta: number
  /** 選べる特性（上乗せの候補）。 */
  traits: ReadonlySet<string>
}

/** 選択駒の上限。絞り込みの区分は 2^数 × レベル区分 だけ増える。 */
export const MAX_CHOOSERS = 3

/**
 * 付与元の推定（createGranterCounter）から選択駒を決める。ユニット名は決め打ちしない。
 *
 * - 選択駒 ＝ 付与元と言い切れる特性が2つ以上あるユニット。上乗せ数はその中で一番多い値。
 * - 選べる特性 ＝ 同じ上乗せ数で、そのユニットが一番よく同席している特性。言い切れなくてもよい
 *   （ラックスの魔女・ソーラーは別の経路の上乗せが混じって言い切れないが、選べる特性ではある）。
 *
 * セット18 では カ＝ジックス（進化4種、+1）と ラックス（出自、+2）。エルダードラゴンは1特性だけなので入らない。
 * 上乗せが多い順に MAX_CHOOSERS まで。
 */
export function choosersFromGranters(guesses: readonly GranterGuess[]): Chooser[] {
  const byUnit = new Map<string, GranterGuess[]>()
  for (const g of guesses) {
    const list = byUnit.get(g.unitApi) ?? []
    list.push(g)
    byUnit.set(g.unitApi, list)
  }
  const out: (Chooser & { total: number })[] = []
  for (const [api, list] of byUnit) {
    const confident = list.filter((g) => g.confident)
    if (new Set(confident.map((g) => g.traitApi)).size < 2) continue
    const deltaCounts = new Map<number, number>()
    for (const g of confident) deltaCounts.set(g.delta, (deltaCounts.get(g.delta) ?? 0) + 1)
    const delta = [...deltaCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
    const picks = list.filter((g) => g.delta === delta)
    out.push({
      api,
      delta,
      traits: new Set(picks.map((g) => g.traitApi)),
      total: picks.reduce((s, g) => s + g.total, 0),
    })
  }
  return out
    .sort((a, b) => b.total - a.total || (a.api < b.api ? -1 : 1))
    .slice(0, MAX_CHOOSERS)
    .map(({ api, delta, traits }) => ({ api, delta, traits }))
}

export interface SummaryBuilder {
  add(rec: ParticipantRecord): void
  finish(): Omit<WireSummaryView, 'key' | 'label'>
}

type TraitRow = [number, number, WireRecordStat, WireRecordStat, WireRecordStat]

interface Entry {
  ti: number
  e: TraitTierEntry
}

/** 紋章・特性・選択駒の成績の入れ物。ビュー全体と、絞り込みの区分ごとに1つずつ持つ。 */
function createAcc() {
  const emblems = new Map<number, WireRecordStat>()
  const noEmblem = emptyStat()
  // `${traitIdx}|${min}` → [全体, 紋章あり, 紋章なし]
  const traits = new Map<string, TraitRow>()
  // `${chooserIdx}|${traitIdx}` → 成績
  const picks = new Map<string, [number, number, WireRecordStat]>()
  let participants = 0
  return {
    add(rec: ParticipantRecord, emblemIdxs: number[], entries: Entry[], pickIdxs: [number, number][]) {
      participants++
      if (emblemIdxs.length === 0) addStat(noEmblem, rec)
      for (const i of emblemIdxs) {
        let s = emblems.get(i)
        if (!s) emblems.set(i, (s = emptyStat()))
        addStat(s, rec)
      }
      for (const { ti, e } of entries) {
        const key = `${ti}|${e.min}`
        let row = traits.get(key)
        if (!row) traits.set(key, (row = [ti, e.min, emptyStat(), emptyStat(), emptyStat()]))
        addStat(row[2], rec)
        if (e.split === 'with') addStat(row[3], rec)
        else if (e.split === 'without') addStat(row[4], rec)
      }
      for (const [ci, ti] of pickIdxs) {
        const key = `${ci}|${ti}`
        let row = picks.get(key)
        if (!row) picks.set(key, (row = [ci, ti, emptyStat()]))
        addStat(row[2], rec)
      }
    },
    finish() {
      return {
        participants,
        emblems: [...emblems.entries()].sort((a, b) => a[0] - b[0]),
        noEmblem,
        traits: [...traits.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
        picks: [...picks.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      }
    },
  }
}

/**
 * 1ビュー分の集計器。
 *
 * - 紋章: classifyEmblems の「活用」で数える（構成一覧と同じ定義）。1人が同じ紋章を2枚活用しても1人。
 * - 特性: `rec.tc`（発動数）から発動段を引き、段の下限体数ごとに数える。`tc` を持たない旧レコードは
 *   段が分からないので特性の集計に入れない（紋章の集計には入る）。
 * - 選択駒（choosers）: 盤面に居る人の、選んだ特性（上乗せが選択駒の上乗せ数と一致するもの）ごと。
 *   発動していない選択は tc に出ないので数えられない。
 * - 同じものを、レベル区分（〜7 / 8 / 9 / 10）× 選択駒の有無 の区分ごとにも数える。1人は1区分だけに入り、
 *   画面は選んだ条件に合う区分を足し合わせる。
 */
export function createSummaryBuilder(staticData: StaticData, choosers: readonly Chooser[] = []): SummaryBuilder {
  const emblemIdx = new Map([...staticData.emblems.keys()].map((api, i) => [api, i]))
  const traitIdx = new Map([...staticData.traits.keys()].map((api, i) => [api, i]))
  const all = createAcc()
  const cells = new Map<string, { lv: LevelKey; c: number; acc: ReturnType<typeof createAcc> }>()
  const matches = new Set<string>()

  return {
    add(rec) {
      matches.add(rec.m)
      const { activeEmblemApis } = classifyEmblems(rec, staticData)
      const emblemIdxs = [...activeEmblemApis].map((api) => emblemIdx.get(api)!)
      const entries = traitTierEntries(rec, staticData, activeEmblemApis).map((e) => ({ ti: traitIdx.get(e.api)!, e }))
      let c = 0
      const pickIdxs: [number, number][] = []
      if (choosers.length > 0) {
        const cls = classifyRecord(rec, staticData)
        const boardSet = cls.kind === 'ok' ? cls.boardSet : undefined
        if (boardSet && choosers.some((ch) => boardSet.has(ch.api))) {
          const grants = inferTraitGrants(rec, staticData, boardSet)
          choosers.forEach((ch, ci) => {
            if (!boardSet.has(ch.api)) return
            c |= 1 << ci
            for (const [t, d] of grants) if (d === ch.delta && ch.traits.has(t)) pickIdxs.push([ci, traitIdx.get(t)!])
          })
        }
      }
      all.add(rec, emblemIdxs, entries, pickIdxs)
      const lv = levelKeyOf(rec.lv)
      const key = `${lv}|${c}`
      let cell = cells.get(key)
      if (!cell) cells.set(key, (cell = { lv, c, acc: createAcc() }))
      cell.acc.add(rec, emblemIdxs, entries, pickIdxs)
    },
    finish() {
      const lvOrder = (lv: LevelKey) => LEVEL_KEYS.indexOf(lv)
      return {
        matches: matches.size,
        ...all.finish(),
        cells: [...cells.values()]
          .sort((a, b) => lvOrder(a.lv) - lvOrder(b.lv) || a.c - b.c)
          .map(({ lv, c, acc }) => ({ lv, c, ...acc.finish() })),
      }
    },
  }
}

/** summary.json の選択駒の辞書。createSummaryBuilder の choosers と同じ並び。 */
export function summaryChoosers(staticData: StaticData, choosers: readonly Chooser[]): WireSummaryChooser[] {
  const traitIdx = new Map([...staticData.traits.keys()].map((api, i) => [api, i]))
  return choosers.map((ch) => {
    const u = staticData.units.get(ch.api)
    return {
      api: ch.api,
      name: u?.name ?? ch.api,
      nameJa: u?.nameJa ?? ch.api,
      icon: u?.icon ?? '',
      traits: [...ch.traits].map((t) => traitIdx.get(t)!).sort((a, b) => a - b),
    }
  })
}

/**
 * summary.json の辞書。createSummaryBuilder の idx と同じ並び（staticData の Map の順）。
 * 構成一覧のファイルと違って使われたものだけに絞らない（特性・紋章は数十件しかない）。
 */
export function summaryDictionaries(staticData: StaticData): { traits: TraitInfo[]; emblems: EmblemInfo[] } {
  const traitIdx = new Map([...staticData.traits.keys()].map((api, i) => [api, i]))
  const traits = [...staticData.traits].map(([api, t]) => ({ api, name: t.name, nameJa: t.nameJa, icon: t.icon, tiers: t.tiers }))
  const emblems = [...staticData.emblems].map(([api, e]) => ({
    api,
    name: e.name,
    nameJa: e.nameJa,
    trait: traitIdx.get(e.traitApi)!,
    icon: e.icon,
    base: e.base,
    recipe: e.recipe,
  }))
  return { traits, emblems }
}
