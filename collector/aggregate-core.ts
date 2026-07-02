// aggregate.ts の集計ロジック本体を純関数として分離したモジュール。
// ここには fs / fetch / process / console への依存を持ち込まない（テスト可能に保つ）。
// 出力バイト列を変えないため、各関数のロジックは aggregate.ts の元コードを忠実に踏襲する。

import type { StaticData } from './cdragon.ts'
import type {
  ParticipantRecord,
  WireStatsFile,
  WireComp,
  TraitInfo,
  EmblemInfo,
  UnitInfo,
  ItemInfo,
} from '../shared/types.ts'

// 召喚ユニット（ビア＆バイン=TFT17_Summon・ミィプシー=TFT17_IvernMinion・PVE等）は
// 導き手等で盤面にレベル+1で出現するため構成ユニットから除外（レベルと整合）。
export const NON_BOARD_UNIT_RE = /_Summon$|Minion|PVE|Enemy_|TrainingDummy/

// 集計定数。
/** 出力対象とする構成の総レコード数の下限。 */
export const MIN_OUTPUT_N = 3
/** 推奨アイテムを収集する上位ユニット数（保持総数順）。 */
export const CARRY_UNITS = 4
/** ユニットごとに表示する推奨アイテム数。 */
export const ITEMS_PER_UNIT = 3
/** 紋章ごとに表示する装備者数。 */
export const HOLDERS_PER_EMBLEM = 3
/** 装備者採用の最小シェア（先頭は無条件採用）。 */
export const HOLDER_MIN_SHARE = 0.2

export interface LoadedRecord {
  rec: ParticipantRecord
  route: string
}

/**
 * count 以下の最大ブレークポイントを返す。
 * bps が未定義/空、または count 以下のブレークポイントが存在しない場合は count を返す。
 */
export function activeBreakpoint(count: number, bps: number[] | undefined): number {
  if (!bps || bps.length === 0) return count
  let best: number | undefined
  for (const bp of bps) {
    if (bp <= count && (best === undefined || bp > best)) best = bp
  }
  return best ?? count
}

/** 最頻値（同数なら大きい方）。空なら undefined。 */
export function modeMaxNumber(values: number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: number | undefined
  let bestCount = -1
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && best !== undefined && v > best)) {
      bestCount = c
      best = v
    }
  }
  return best
}

/**
 * 重複ガード（同一 (m, p) は最初の1件のみ）。
 */
export function dedupeRecords(all: LoadedRecord[]): { deduped: LoadedRecord[]; dupSkipped: number } {
  const seenMP = new Set<string>()
  let dupSkipped = 0
  const deduped: LoadedRecord[] = []
  for (const lr of all) {
    const key = `${lr.rec.m}|${lr.rec.p}`
    if (seenMP.has(key)) {
      dupSkipped++
      continue
    }
    seenMP.add(key)
    deduped.push(lr)
  }
  return { deduped, dupSkipped }
}

export interface SplitBoardResult {
  /** 盤面ユニット apiName（昇順・構成キー用）。 */
  boardApis: string[]
  /** 盤面ユニット集合（表示用収集のメンバシップ判定に使用）。 */
  boardSet: Set<string>
  /** 盤面から除外したユニット（召喚等）の特性寄与。num_units の盤面実効数補正に使う。 */
  summonTraitCount: Map<string, number>
  /** 静的データに解決できなかったユニット apiName（診断用・重複含む）。 */
  unresolvedUnits: string[]
}

/**
 * 盤面ユニット集合を構築する（召喚・非ショップ除外、コスト1-5、重複除去）。
 * 盤面から除外したユニット（召喚等）の特性寄与は summonTraitCount に記録する
 * （召喚も Riot の num_units に含まれるため、盤面実効数補正に必要）。
 */
export function splitBoardUnits(rec: ParticipantRecord, staticData: StaticData): SplitBoardResult {
  const boardSet = new Set<string>()
  const summonTraitCount = new Map<string, number>()
  const unresolvedUnits: string[] = []
  for (const uApi of rec.u) {
    if (!staticData.units.has(uApi)) {
      unresolvedUnits.push(uApi)
      continue
    }
    const uInfo = staticData.units.get(uApi)!
    if (uInfo.cost < 1 || uInfo.cost > 5 || NON_BOARD_UNIT_RE.test(uApi)) {
      for (const tApi of uInfo.traits) {
        summonTraitCount.set(tApi, (summonTraitCount.get(tApi) ?? 0) + 1)
      }
      continue
    }
    boardSet.add(uApi)
  }
  const boardApis = [...boardSet].sort()
  return { boardApis, boardSet, summonTraitCount, unresolvedUnits }
}

export interface ClassifyEmblemsResult {
  /** +1 紋章（ちょうどブレークポイント）の apiName（未ソート・個数分積む）。 */
  oneApisArr: string[]
  /** +0.5 紋章（ブレークポイント超過）の apiName（未ソート・個数分積む）。 */
  halfApisArr: string[]
  /** 発動している（付与トレイトが tier>=1）紋章 apiName 集合。装備者収集のゲートに使う。 */
  activeEmblemApis: Set<string>
  /** 静的データに解決できなかった紋章 apiName（診断用・重複含む）。 */
  unresolvedEmblems: string[]
}

/**
 * 紋章活用スコアを算出し one/half バケットへ振り分ける。
 * 同一紋章を複数装備した場合は同数だけ配列に積む（multiplicity 保持）。
 * summonTraitCount は splitBoardUnits の返り値を渡す（盤面実効特性数の補正に使用）。
 */
export function classifyEmblems(
  rec: ParticipantRecord,
  staticData: StaticData,
  summonTraitCount: Map<string, number>,
): ClassifyEmblemsResult {
  // 発動トレイト集合（紋章の発動判定に使用）。
  const recTraitKeys = new Set(Object.keys(rec.t))

  const emblemInstances = new Map<string, number>()
  for (const eApi of rec.e) emblemInstances.set(eApi, (emblemInstances.get(eApi) ?? 0) + 1)

  const oneApisArr: string[] = []
  const halfApisArr: string[] = []
  const activeEmblemApis = new Set<string>()
  const unresolvedEmblems: string[] = []
  for (const [eApi, inst] of emblemInstances) {
    const emb = staticData.emblems.get(eApi)
    if (!emb) {
      unresolvedEmblems.push(eApi)
      continue
    }
    // 付与特性（変種含む）のうち発動中(tier>=1)のもの。最大 num_units の変種を採用。
    let bestVariant: string | undefined
    let bestRaw = -1
    for (const a of emb.traitApis) {
      if (recTraitKeys.has(a)) {
        const nu = rec.tc?.[a] ?? 0
        if (nu > bestRaw) {
          bestRaw = nu
          bestVariant = a
        }
      }
    }
    if (!bestVariant) continue // 発動していない紋章は活用に数えない
    activeEmblemApis.add(eApi)

    // 盤面実効特性数 = Riot num_units − 召喚ユニットの当該特性寄与。
    const effective = Math.max(0, (rec.tc?.[bestVariant] ?? 0) - (summonTraitCount.get(bestVariant) ?? 0))
    if (effective <= 0) continue // 盤面に実体が無い（召喚のみ）→ 活用に数えない

    // 余り判定: 実効数がちょうどブレークポイントなら +1、超過なら +0.5。
    const bp = activeBreakpoint(effective, staticData.traitBreakpoints.get(bestVariant))
    const bucket = effective > bp ? halfApisArr : oneApisArr
    for (let j = 0; j < inst; j++) bucket.push(eApi)
  }
  return { oneApisArr, halfApisArr, activeEmblemApis, unresolvedEmblems }
}

export interface AggregateDiag {
  /** 盤面ユニットが1体も無く除外したレコード数。 */
  noBoard: number
  /** 未解決トレイトを含み除外したレコード数。 */
  excludedUnresolvedTrait: number
  /** 盤面グループ（構成キー）数。 */
  boardGroupCount: number
  /** 未解決トレイト apiName 集合（該当レコード除外）。 */
  unresolvedTraitNames: Set<string>
  /** 未解決ユニット apiName 集合（該当ユニットのみ無視）。 */
  unresolvedUnitNames: Set<string>
  /** 未解決紋章 apiName 集合（該当紋章のみ無視）。 */
  unresolvedEmblemNames: Set<string>
}

/**
 * 盤面グルーピング〜シグネチャ集計〜出力整形〜インターン〜Wire 圧縮までの集計本体。
 * generatedAt / targetPatch / tftPatch は副作用（時刻・設定）を排除するため引数注入する。
 * 診断カウンタ・警告元データは diag として返す（呼び出し側がログ整形する）。
 */
export function buildStats(
  target: LoadedRecord[],
  staticData: StaticData,
  opts: { targetPatch: string; tftPatch: string; generatedAt: string },
): { out: WireStatsFile; diag: AggregateDiag } {
  const unresolvedTraitNames = new Set<string>()
  const unresolvedUnitNames = new Set<string>()
  const unresolvedEmblemNames = new Set<string>()

  // 盤面ユニット集合でグルーピング ＋ 紋章活用シグネチャ集計。
  interface SigAcc {
    one: string[] // +1 紋章 apiName（ソート済み）
    half: string[] // +0.5 紋章 apiName（ソート済み）
    n: number
    top4: number
    win: number
    p: number // 順位合計
  }
  interface CompAcc {
    unitApis: string[] // 盤面ユニット apiName（ソート済み・構成キー）
    n: number
    // 表示用
    unitStarLists: Map<string, number[]>
    itemCounts: Map<string, Map<string, number>>
    holderCounts: Map<string, Map<string, number>>
    // 紋章活用シグネチャ
    sigs: Map<string, SigAcc>
  }

  const map = new Map<string, CompAcc>()
  let noBoard = 0
  let excludedUnresolvedTrait = 0

  for (const lr of target) {
    const rec = lr.rec

    // 未解決トレイトを含むレコードは集計から除外（カバレッジ100%なら発生しない）。
    let hasUnresolvedTrait = false
    for (const tApi of Object.keys(rec.t)) {
      if (!staticData.traits.has(tApi)) {
        unresolvedTraitNames.add(tApi)
        hasUnresolvedTrait = true
      }
    }
    if (hasUnresolvedTrait) {
      excludedUnresolvedTrait++
      continue
    }

    const { boardApis, boardSet, summonTraitCount, unresolvedUnits } = splitBoardUnits(rec, staticData)
    for (const u of unresolvedUnits) unresolvedUnitNames.add(u)
    if (boardSet.size === 0) {
      noBoard++
      continue
    }
    const boardKey = boardApis.join('|')

    let acc = map.get(boardKey)
    if (!acc) {
      acc = {
        unitApis: boardApis,
        n: 0,
        unitStarLists: new Map(),
        itemCounts: new Map(),
        holderCounts: new Map(),
        sigs: new Map(),
      }
      map.set(boardKey, acc)
    }
    acc.n++

    // ユニット別スター・完成アイテム（盤面ユニットのみ）。
    for (let i = 0; i < rec.u.length; i++) {
      const uApi = rec.u[i]
      if (!boardSet.has(uApi)) continue
      const star = rec.us?.[i]
      if (star && star > 0) {
        const list = acc.unitStarLists.get(uApi) ?? []
        list.push(star)
        acc.unitStarLists.set(uApi, list)
      }
      const unitItemList = rec.ui?.[i]
      if (unitItemList && unitItemList.length) {
        let im = acc.itemCounts.get(uApi)
        if (!im) {
          im = new Map()
          acc.itemCounts.set(uApi, im)
        }
        for (const it of unitItemList) {
          if (staticData.items.has(it)) im.set(it, (im.get(it) ?? 0) + 1)
        }
      }
    }

    // 紋章活用スコア → シグネチャ。
    const { oneApisArr, halfApisArr, activeEmblemApis, unresolvedEmblems } = classifyEmblems(
      rec,
      staticData,
      summonTraitCount,
    )
    for (const e of unresolvedEmblems) unresolvedEmblemNames.add(e)

    // 装備者（発動ゲート済み・インスタンス単位）。
    for (let k = 0; k < rec.e.length; k++) {
      const eApi = rec.e[k]
      if (!activeEmblemApis.has(eApi)) continue
      const holder = rec.eh?.[k]
      if (holder && staticData.units.has(holder)) {
        let hc = acc.holderCounts.get(eApi)
        if (!hc) {
          hc = new Map()
          acc.holderCounts.set(eApi, hc)
        }
        hc.set(holder, (hc.get(holder) ?? 0) + 1)
      }
    }

    if (oneApisArr.length === 0 && halfApisArr.length === 0) continue // 発動紋章なし → シグネチャ対象外

    const oneApis = oneApisArr.sort()
    const halfApis = halfApisArr.sort()
    const sigKey = JSON.stringify([oneApis, halfApis])
    let sig = acc.sigs.get(sigKey)
    if (!sig) {
      sig = { one: oneApis, half: halfApis, n: 0, top4: 0, win: 0, p: 0 }
      acc.sigs.set(sigKey, sig)
    }
    sig.n++
    if (rec.p <= 4) sig.top4++
    if (rec.p === 1) sig.win++
    sig.p += rec.p
  }

  // 出力対象（総レコード n>=MIN_OUTPUT_N）。
  const usedTraitApis = new Set<string>()
  const usedUnitApis = new Set<string>()
  const usedEmblemApis = new Set<string>()
  const usedItemApis = new Set<string>()

  interface PreComp {
    unitApis: string[]
    n: number
    unitStarByApi: Map<string, number>
    unitItems: [string, string, number][] // [unitApi, itemApi, count]
    holders: [string, string, number][] // [emblemApi, unitApi, count]
    sigs: SigAcc[]
  }

  const preComps: PreComp[] = []
  for (const acc of map.values()) {
    if (acc.n < MIN_OUTPUT_N) continue

    // 盤面ユニットと、その所持トレイトを used に追加（フロントの発動数算出に使う）。
    for (const u of acc.unitApis) {
      usedUnitApis.add(u)
      for (const tApi of staticData.units.get(u)?.traits ?? []) usedTraitApis.add(tApi)
    }

    // 代表スター。
    const unitStarByApi = new Map<string, number>()
    for (const uApi of acc.unitApis) {
      const ms = modeMaxNumber(acc.unitStarLists.get(uApi) ?? [])
      if (ms) unitStarByApi.set(uApi, ms)
    }

    // 推奨アイテム（保持総数上位 CARRY_UNITS ユニット × 上位 ITEMS_PER_UNIT）。
    const unitItems: [string, string, number][] = []
    const carries = [...acc.itemCounts.entries()]
      .map(([uApi, im]) => ({ uApi, im, total: [...im.values()].reduce((s, x) => s + x, 0) }))
      .sort(
        (a, b) =>
          b.total - a.total ||
          (staticData.units.get(a.uApi)!.name < staticData.units.get(b.uApi)!.name ? -1 : 1),
      )
      .slice(0, CARRY_UNITS)
    for (const { uApi, im } of carries) {
      const topItems = [...im.entries()]
        .sort(
          (a, b) =>
            b[1] - a[1] ||
            (staticData.items.get(a[0])!.name < staticData.items.get(b[0])!.name ? -1 : 1),
        )
        .slice(0, ITEMS_PER_UNIT)
      for (const [itApi, count] of topItems) {
        unitItems.push([uApi, itApi, count])
        usedUnitApis.add(uApi)
        usedItemApis.add(itApi)
      }
    }

    // 装備者。
    const holders: [string, string, number][] = []
    for (const [emblemApi, hc] of acc.holderCounts) {
      const total = [...hc.values()].reduce((s, x) => s + x, 0)
      const sorted = [...hc.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        const na = staticData.units.get(a[0])!.name
        const nb = staticData.units.get(b[0])!.name
        return na < nb ? -1 : na > nb ? 1 : a[0] < b[0] ? -1 : 1
      })
      const picked = sorted.filter(([, c], i) => i === 0 || c / total >= HOLDER_MIN_SHARE)
      for (const [unitApi, count] of picked.slice(0, HOLDERS_PER_EMBLEM)) {
        holders.push([emblemApi, unitApi, count])
        usedUnitApis.add(unitApi)
        usedEmblemApis.add(emblemApi)
      }
    }

    // シグネチャ（紋章 idx は後でインターン）。
    const sigs = [...acc.sigs.values()]
    for (const s of sigs) {
      for (const e of s.one) usedEmblemApis.add(e)
      for (const e of s.half) usedEmblemApis.add(e)
    }

    preComps.push({
      unitApis: acc.unitApis,
      n: acc.n,
      unitStarByApi,
      unitItems,
      holders,
      sigs,
    })
  }

  // emblems の traitApi 参照先も used に追加。
  for (const eApi of usedEmblemApis) {
    const emb = staticData.emblems.get(eApi)
    if (emb) usedTraitApis.add(emb.traitApi)
  }

  // インターン配列（決定的順序）。
  const traitApisSorted = [...usedTraitApis].sort((a, b) => {
    const na = staticData.traits.get(a)!.name
    const nb = staticData.traits.get(b)!.name
    return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  const traitIndex = new Map<string, number>()
  const traitsOut: TraitInfo[] = traitApisSorted.map((api, i) => {
    traitIndex.set(api, i)
    const t = staticData.traits.get(api)!
    return { api, name: t.name, nameJa: t.nameJa, icon: t.icon, tiers: t.tiers }
  })

  const unitApisSorted = [...usedUnitApis].sort((a, b) => {
    const ua = staticData.units.get(a)!
    const ub = staticData.units.get(b)!
    if (ua.cost !== ub.cost) return ua.cost - ub.cost
    return ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  const unitIndex = new Map<string, number>()
  const unitsOut: UnitInfo[] = unitApisSorted.map((api, i) => {
    unitIndex.set(api, i)
    const u = staticData.units.get(api)!
    // 所持トレイトを traitIdx へ（インターン済みのもののみ）。
    const traitIdxs = u.traits
      .map((t) => traitIndex.get(t))
      .filter((x): x is number => x !== undefined)
    return { api, name: u.name, nameJa: u.nameJa, cost: u.cost, icon: u.icon, code: u.code, traits: traitIdxs }
  })

  const emblemApisSorted = [...usedEmblemApis].sort((a, b) => {
    const ea = staticData.emblems.get(a)!
    const eb = staticData.emblems.get(b)!
    return ea.name < eb.name ? -1 : ea.name > eb.name ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  const emblemIndex = new Map<string, number>()
  const emblemsOut: EmblemInfo[] = emblemApisSorted.map((api, i) => {
    emblemIndex.set(api, i)
    const e = staticData.emblems.get(api)!
    return { api, name: e.name, nameJa: e.nameJa, trait: traitIndex.get(e.traitApi)!, icon: e.icon, base: e.base, recipe: e.recipe }
  })

  const itemApisSorted = [...usedItemApis].sort((a, b) => {
    const ia = staticData.items.get(a)!
    const ib = staticData.items.get(b)!
    return ia.name < ib.name ? -1 : ia.name > ib.name ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  const itemIndex = new Map<string, number>()
  const itemsOut: ItemInfo[] = itemApisSorted.map((api, i) => {
    itemIndex.set(api, i)
    const it = staticData.items.get(api)!
    return { api, name: it.name, nameJa: it.nameJa, icon: it.icon, recipe: it.recipe }
  })

  // PreComp → WireComp。
  function toWire(pc: PreComp): WireComp {
    const unitIdxs = pc.unitApis
      .map((api) => unitIndex.get(api)!)
      .sort((a, b) => {
        const ua = unitsOut[a]
        const ub = unitsOut[b]
        if (ua.cost !== ub.cost) return ua.cost - ub.cost
        return ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : a - b
      })
    const unitStars = unitIdxs.map((idx) => pc.unitStarByApi.get(unitsOut[idx].api) ?? 0)

    const unitItems: [number, number, number][] = pc.unitItems
      .map(([unitApi, itemApi, count]): [number, number, number] => [
        unitIndex.get(unitApi)!,
        itemIndex.get(itemApi)!,
        count,
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const holders: [number, number, number][] = pc.holders
      .map(([emblemApi, unitApi, count]): [number, number, number] => [
        emblemIndex.get(emblemApi)!,
        unitIndex.get(unitApi)!,
        count,
      ])
      .sort((a, b) => a[0] - b[0])

    const g: [number[], number[], number, number, number, number][] = pc.sigs
      .map((s): [number[], number[], number, number, number, number] => [
        s.one.map((e) => emblemIndex.get(e)!).sort((x, y) => x - y),
        s.half.map((e) => emblemIndex.get(e)!).sort((x, y) => x - y),
        s.n,
        s.top4,
        s.win,
        s.p,
      ])
      .sort((a, b) => b[2] - a[2])

    const wire: WireComp = { u: unitIdxs, n: pc.n, g }
    if (unitStars.some((s) => s > 0)) wire.k = unitStars
    if (unitItems.length) wire.i = unitItems
    if (holders.length) wire.h = holders
    return wire
  }

  const comps: WireComp[] = preComps.map(toWire).sort((a, b) => b.n - a.n)

  const byRoute: Record<string, number> = {}
  const uniqueMatches = new Set<string>()
  for (const lr of target) {
    byRoute[lr.route] = (byRoute[lr.route] ?? 0) + 1
    uniqueMatches.add(lr.rec.m)
  }

  const out: WireStatsFile = {
    schemaVersion: 3,
    generatedAt: opts.generatedAt,
    patch: opts.targetPatch,
    tftPatch: opts.tftPatch,
    setNumber: staticData.setNumber,
    totals: {
      matches: uniqueMatches.size,
      participants: target.length,
      byRoute,
    },
    traits: traitsOut,
    emblems: emblemsOut,
    units: unitsOut,
    items: itemsOut,
    comps,
    baseItemIcons: staticData.baseItemIcons,
  }

  const diag: AggregateDiag = {
    noBoard,
    excludedUnresolvedTrait,
    boardGroupCount: map.size,
    unresolvedTraitNames,
    unresolvedUnitNames,
    unresolvedEmblemNames,
  }

  return { out, diag }
}
