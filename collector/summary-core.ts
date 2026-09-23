// 統計ページ（public/data/summary.json）の集計。純関数。
//
// 構成一覧の成績は「紋章を活用した試合」の部分集合（全参加者の約25%、平均順位 4.16）に偏るので、
// 紋章や特性そのものの強さを測る母集団にならない。ここでは盤面の完全一致も紋章の有無も問わず、
// 対象レコードを全部数える。

import type { StaticData } from './cdragon.ts'
import type { EmblemInfo, ParticipantRecord, TraitInfo, WireRecordStat, WireSummaryView } from '../shared/types.ts'
import { classifyEmblems, tierOfCount } from './aggregate-core.ts'

const emptyStat = (): WireRecordStat => [0, 0, 0, 0, 0]

function addStat(s: WireRecordStat, rec: ParticipantRecord): void {
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

export interface SummaryBuilder {
  add(rec: ParticipantRecord): void
  finish(): Omit<WireSummaryView, 'key' | 'label'>
}

/**
 * 1ビュー分の集計器。
 *
 * - 紋章: classifyEmblems の「活用」で数える（構成一覧と同じ定義）。1人が同じ紋章を2枚活用しても1人。
 * - 特性: `rec.tc`（発動数）から発動段を引き、段の下限体数ごとに数える。`tc` を持たない旧レコードは
 *   段が分からないので特性の集計に入れない（紋章の集計には入る）。
 */
export function createSummaryBuilder(staticData: StaticData): SummaryBuilder {
  const emblemIdx = new Map([...staticData.emblems.keys()].map((api, i) => [api, i]))
  const traitIdx = new Map([...staticData.traits.keys()].map((api, i) => [api, i]))
  const emblems = new Map<number, WireRecordStat>()
  const noEmblem = emptyStat()
  // `${traitIdx}|${min}` → [全体, 紋章あり, 紋章なし]
  const traits = new Map<string, [number, number, WireRecordStat, WireRecordStat, WireRecordStat]>()
  const matches = new Set<string>()
  let participants = 0

  return {
    add(rec) {
      participants++
      matches.add(rec.m)
      const { activeEmblemApis } = classifyEmblems(rec, staticData)
      if (activeEmblemApis.size === 0) addStat(noEmblem, rec)
      for (const api of activeEmblemApis) {
        const i = emblemIdx.get(api)!
        let s = emblems.get(i)
        if (!s) emblems.set(i, (s = emptyStat()))
        addStat(s, rec)
      }

      const tc = rec.tc
      if (!tc) return
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
      for (const t of Object.keys(rec.t)) {
        const ti = traitIdx.get(t)
        const count = tc[t]
        if (ti === undefined || count === undefined) continue
        const tiers = staticData.traits.get(t)!.tiers
        const tier = tierOfCount(tiers, count)
        if (tier === 0) continue
        const min = tiers[tier - 1][0]
        const key = `${ti}|${min}`
        let row = traits.get(key)
        if (!row) traits.set(key, (row = [ti, min, emptyStat(), emptyStat(), emptyStat()]))
        addStat(row[2], rec)
        if (used.has(t)) addStat(row[3], rec)
        else if (!equipped.has(t)) addStat(row[4], rec)
      }
    },
    finish() {
      return {
        matches: matches.size,
        participants,
        emblems: [...emblems.entries()].sort((a, b) => a[0] - b[0]),
        noEmblem,
        traits: [...traits.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      }
    },
  }
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
