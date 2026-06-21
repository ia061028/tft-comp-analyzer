// Phase 3: data/state/records/*.ndjson → public/data/stats.json
// 構成 = 盤面ユニット集合が完全一致するレコード群（クラスタリングはしない）。
// 各構成に「紋章活用シグネチャ(sig)」を持たせ、選択紋章に応じた活用判定はランタイムで行う。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'
import { pickTargetPatch, compareVersions } from './patches.ts'
import { getStaticData, type StaticData } from './cdragon.ts'
import type {
  ParticipantRecord,
  WireStatsFile,
  WireComp,
  TraitInfo,
  EmblemInfo,
  UnitInfo,
  ItemInfo,
} from '../shared/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const RECORDS_DIR = join(ROOT, 'data', 'state', 'records')
const OUT_DIR = join(ROOT, 'public', 'data')
const OUT_PATH = join(OUT_DIR, 'stats.json')

// 召喚ユニット（ビア＆バイン=TFT17_Summon・ミィプシー=TFT17_IvernMinion・PVE等）は
// 導き手等で盤面にレベル+1で出現するため構成ユニットから除外（レベルと整合）。
const NON_BOARD_UNIT_RE = /_Summon$|Minion|PVE|Enemy_|TrainingDummy/

interface LoadedRecord {
  rec: ParticipantRecord
  route: string
}

/**
 * count 以下の最大ブレークポイントを返す。
 * bps が未定義/空、または count 以下のブレークポイントが存在しない場合は count を返す。
 */
function activeBreakpoint(count: number, bps: number[] | undefined): number {
  if (!bps || bps.length === 0) return count
  let best: number | undefined
  for (const bp of bps) {
    if (bp <= count && (best === undefined || bp > best)) best = bp
  }
  return best ?? count
}

/** 最頻値（同数なら大きい方）。空なら undefined。 */
function modeMaxNumber(values: number[]): number | undefined {
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

async function main(): Promise<void> {
  // 1. 読み込み
  if (!existsSync(RECORDS_DIR)) {
    console.error(`records ディレクトリが存在しません: ${RECORDS_DIR}`)
    process.exit(1)
  }
  const files = readdirSync(RECORDS_DIR).filter((f) => f.endsWith('.ndjson'))
  if (files.length === 0) {
    console.error('*.ndjson ファイルが見つかりません。')
    process.exit(1)
  }

  let parseFailures = 0
  const all: LoadedRecord[] = []
  for (const file of files) {
    const route = basename(file, '.ndjson')
    const raw = readFileSync(join(RECORDS_DIR, file), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const rec = JSON.parse(trimmed) as ParticipantRecord
        all.push({ rec, route })
      } catch {
        parseFailures++
      }
    }
  }
  console.log(`読み込み: ${files.length} ファイル, ${all.length} レコード（parse失敗 ${parseFailures}）`)

  // 2. 重複ガード（同一 (m, p) は最初の1件のみ）
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
  console.log(`重複ガード: ${dupSkipped} 件スキップ → ${deduped.length} レコード`)

  // 3. パッチ選定（ヒステリシス: ユニークマッチ数 >= threshold の最新パッチ）
  const patchRecordCounts = new Map<string, number>()
  const patchMatchSets = new Map<string, Set<string>>()
  for (const lr of deduped) {
    patchRecordCounts.set(lr.rec.v, (patchRecordCounts.get(lr.rec.v) ?? 0) + 1)
    let set = patchMatchSets.get(lr.rec.v)
    if (!set) {
      set = new Set<string>()
      patchMatchSets.set(lr.rec.v, set)
    }
    set.add(lr.rec.m)
  }
  const matchCountByPatch = new Map<string, number>()
  for (const [v, set] of patchMatchSets) matchCountByPatch.set(v, set.size)

  const patchEntries = [...patchRecordCounts.entries()].sort((a, b) => compareVersions(b[0], a[0]))
  console.log(`パッチ分布（ヒステリシス閾値=${config.patchSwitchThreshold} ユニークマッチ）:`)
  for (const [v, recCount] of patchEntries) {
    const matches = matchCountByPatch.get(v) ?? 0
    const meets = matches >= config.patchSwitchThreshold ? '達' : '未達'
    console.log(`  ${v}: ユニークマッチ=${matches} (${meets}) / レコード=${recCount}`)
  }
  const targetPatch = pickTargetPatch(matchCountByPatch, config.patchSwitchThreshold)
  if (targetPatch === null) {
    console.error('対象パッチを選定できません（レコードが空）。')
    process.exit(1)
  }
  console.log(`対象パッチ（ヒステリシス選定）: ${targetPatch}`)

  const target = deduped.filter((lr) => lr.rec.v === targetPatch)

  // 4. 静的データ
  const recordTraitNames = new Set<string>()
  for (const lr of target) for (const k of Object.keys(lr.rec.t)) recordTraitNames.add(k)
  const staticData: StaticData = await getStaticData(recordTraitNames)
  const resolvedTraits = [...recordTraitNames].filter((t) => staticData.traits.has(t)).length
  const coverage =
    recordTraitNames.size === 0 ? 100 : (resolvedTraits / recordTraitNames.size) * 100
  console.log(
    `選定セット: ${staticData.setNumber}, トレイトカバレッジ: ${coverage.toFixed(1)}% ` +
      `(${recordTraitNames.size} 種中 ${resolvedTraits} 解決)`,
  )

  const unresolvedTraitNames = new Set<string>()
  const unresolvedUnitNames = new Set<string>()
  const unresolvedEmblemNames = new Set<string>()

  // 5. 盤面ユニット集合でグルーピング ＋ 紋章活用シグネチャ集計
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

    // 盤面ユニット集合（召喚・非ショップ除外、コスト1-5、重複除去）。
    // 盤面から除外したユニット（召喚等）の特性寄与は、Riot の num_units を盤面実効数に
    // 補正するために記録する（召喚も Riot の特性数に含まれるため）。
    const boardSet = new Set<string>()
    const summonTraitCount = new Map<string, number>()
    for (const uApi of rec.u) {
      if (!staticData.units.has(uApi)) {
        unresolvedUnitNames.add(uApi)
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
    if (boardSet.size === 0) {
      noBoard++
      continue
    }
    const boardApis = [...boardSet].sort()
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

    // 発動トレイト集合（紋章の発動判定に使用）。
    const recTraitKeys = new Set(Object.keys(rec.t))

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

    // 紋章活用スコア → シグネチャ。紋章の個数（multiplicity）を保持する。
    // 同一紋章を複数装備した場合は同数だけ one/half 配列に積む。
    const emblemInstances = new Map<string, number>()
    for (const eApi of rec.e) emblemInstances.set(eApi, (emblemInstances.get(eApi) ?? 0) + 1)

    const oneApisArr: string[] = []
    const halfApisArr: string[] = []
    const activeEmblemApis = new Set<string>()
    for (const [eApi, inst] of emblemInstances) {
      const emb = staticData.emblems.get(eApi)
      if (!emb) {
        unresolvedEmblemNames.add(eApi)
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

  console.log(
    `盤面グループ: ${map.size}（盤面なし除外 ${noBoard}, 未解決トレイト除外 ${excludedUnresolvedTrait}）`,
  )

  // 6. 出力対象（総レコード n>=MIN_OUTPUT_N）。
  const MIN_OUTPUT_N = 3
  const CARRY_UNITS = 4
  const ITEMS_PER_UNIT = 3
  const HOLDERS_PER_EMBLEM = 3
  const HOLDER_MIN_SHARE = 0.2

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

  // 7. インターン配列（決定的順序）。
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
    return { api, name: e.name, nameJa: e.nameJa, trait: traitIndex.get(e.traitApi)!, icon: e.icon, base: e.base }
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
    return { api, name: it.name, nameJa: it.nameJa, icon: it.icon }
  })

  // 8. PreComp → WireComp。
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
    generatedAt: new Date().toISOString(),
    patch: targetPatch,
    tftPatch: config.tftPatchLabels[targetPatch] ?? targetPatch,
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

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(out))

  // 9. ログ
  const sizeBytes = statSync(OUT_PATH).size
  const sizeKB = (sizeBytes / 1024).toFixed(1)
  const totalSigs = comps.reduce((s, c) => s + c.g.length, 0)
  console.log('--- 集計サマリ ---')
  console.log(`TFTパッチ表記: ${out.tftPatch}（内部 ${targetPatch}）`)
  console.log(`comps 数: ${comps.length}, sig 行合計: ${totalSigs}`)
  console.log(
    `インターン: traits=${traitsOut.length} emblems=${emblemsOut.length} units=${unitsOut.length} items=${itemsOut.length}`,
  )
  console.log(
    `totals: matches=${uniqueMatches.size} participants=${target.length} byRoute=${JSON.stringify(byRoute)}`,
  )
  console.log(`出力: ${OUT_PATH} (${sizeKB} KB)`)

  const warnLines: string[] = []
  for (const w of staticData.warnings) warnLines.push(`[静的データ] ${w}`)
  if (parseFailures > 0) warnLines.push(`[parse失敗] ${parseFailures} 行`)
  if (unresolvedTraitNames.size > 0) {
    warnLines.push(
      `[未解決トレイト] ${unresolvedTraitNames.size} 種（該当レコード除外）: ${[...unresolvedTraitNames].sort().join(', ')}`,
    )
  }
  if (unresolvedUnitNames.size > 0) {
    warnLines.push(
      `[未解決ユニット] ${unresolvedUnitNames.size} 種（該当ユニットのみ無視）: ${[...unresolvedUnitNames].sort().join(', ')}`,
    )
  }
  if (unresolvedEmblemNames.size > 0) {
    warnLines.push(
      `[未解決紋章] ${unresolvedEmblemNames.size} 種（該当紋章のみ無視）: ${[...unresolvedEmblemNames].sort().join(', ')}`,
    )
  }
  if (warnLines.length === 0) {
    console.log('警告: なし')
  } else {
    console.log('--- 警告 ---')
    for (const w of warnLines) console.log(`  ${w}`)
  }
}

await main()
