// Phase 3: data/state/records/*.ndjson → public/data/stats.json
// style>=minStyle クラスタリング、発動トレイト紋章フィルタ、マルチセットrow、代表ユニット、インターン。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'
import { pickTargetPatch, compareVersions } from './patches.ts'
import { getStaticData, type StaticData } from './cdragon.ts'
import type {
  ParticipantRecord,
  StatsFile,
  CompStats,
  EmblemRow,
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

interface LoadedRecord {
  rec: ParticipantRecord
  route: string
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
  // マッチ数はレコード数ではなくユニークマッチID数で数える。
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

  const patchEntries = [...patchRecordCounts.entries()].sort((a, b) =>
    compareVersions(b[0], a[0]),
  )
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
  const coverage =
    recordTraitNames.size === 0
      ? 100
      : (([...recordTraitNames].filter((t) => staticData.traits.has(t)).length /
          recordTraitNames.size) *
          100)
  console.log(
    `選定セット: ${staticData.setNumber}, トレイトカバレッジ: ${coverage.toFixed(1)}% ` +
      `(${recordTraitNames.size} 種中 ${[...recordTraitNames].filter((t) => staticData.traits.has(t)).length} 解決)`,
  )

  // 警告集計用（種類ごとのユニーク名）。全バケット横断で dedup される。
  const unresolvedTraitNames = new Set<string>()
  const unresolvedUnitNames = new Set<string>()
  const unresolvedEmblemNames = new Set<string>()

  // 5/6. クラスタリング & クラスタ内集計
  interface ClusterAcc {
    traitApis: string[] // キートレイト apiName（ソート済み）
    n: number
    top4: number
    win: number
    // トレイト apiName → style 値リスト（最頻 style 算出用、代表シナジー判定にも使用）
    styleLists: Map<string, number[]>
    // トレイト apiName → num_units 値リスト（代表ユニット数算出用、tc ありレコードのみ）
    countLists: Map<string, number[]>
    // unit apiName → 出現回数
    unitCounts: Map<string, number>
    // 紋章マルチセット（emblem apiName ソート済み JSON）→ 集計（p=順位合計）
    rows: Map<string, { emblems: string[]; n: number; top4: number; win: number; p: number }>
    // 紋章 apiName → 装備ユニット(character_id) → 回数（holder 集計用、eh ありレコードのみ）
    holderCounts: Map<string, Map<string, number>>
    // unit apiName → item apiName → 回数（推奨アイテム集計用、ui ありレコードのみ）
    itemCounts: Map<string, Map<string, number>>
    // unit apiName → スターレベル値リスト（代表スター算出用、us ありレコードのみ）
    unitStarLists: Map<string, number[]>
  }

  /** レコード集合をクラスタリングして ClusterAcc 群を返す（全体/レベル別で共用）。 */
  function buildClusters(records: LoadedRecord[]): {
    clusters: ClusterAcc[]
    noClusterKey: number
    excludedUnresolvedTrait: number
  } {
    const map = new Map<string, ClusterAcc>()
    let noClusterKey = 0
    let excludedUnresolvedTrait = 0

    for (const lr of records) {
      const rec = lr.rec

      // 未解決トレイト（静的データに無い apiName）を含むレコードは集計から除外。
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

      // クラスタキー: style>=minStyle のトレイトのうち、スタイル降順（同点は apiName 昇順）で
      // 上位 clusterMaxKeyTraits 件を採用し、apiName 昇順で連結（決定的）。
      const goldTraits = Object.entries(rec.t).filter(([, style]) => style >= config.clusterMinStyle)
      if (goldTraits.length === 0) {
        noClusterKey++
        continue
      }
      goldTraits.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      const keyTraits = goldTraits.slice(0, config.clusterMaxKeyTraits).map(([tApi]) => tApi)
      keyTraits.sort()
      const clusterKey = keyTraits.join('|')

      let acc = map.get(clusterKey)
      if (!acc) {
        acc = {
          traitApis: keyTraits,
          n: 0,
          top4: 0,
          win: 0,
          styleLists: new Map(),
          countLists: new Map(),
          unitCounts: new Map(),
          rows: new Map(),
          holderCounts: new Map(),
          itemCounts: new Map(),
          unitStarLists: new Map(),
        }
        map.set(clusterKey, acc)
      }

      acc.n++
      if (rec.p <= 4) acc.top4++
      if (rec.p === 1) acc.win++

      // 発動トレイト全て(tier>=1=ブロンズ以上)の style を蓄積。
      // キートレイトの最頻style算出に加え、代表シナジー（過半数で発動するトレイト）算出に使う。
      for (const [tApi, style] of Object.entries(rec.t)) {
        const list = acc.styleLists.get(tApi) ?? []
        list.push(style)
        acc.styleLists.set(tApi, list)
        const cnt = rec.tc?.[tApi]
        if (cnt && cnt > 0) {
          const clist = acc.countLists.get(tApi) ?? []
          clist.push(cnt)
          acc.countLists.set(tApi, clist)
        }
      }

      // ユニット出現＋ユニット別完成アイテム（解決できるものだけ）
      for (let i = 0; i < rec.u.length; i++) {
        const uApi = rec.u[i]
        if (!staticData.units.has(uApi)) {
          unresolvedUnitNames.add(uApi)
          continue
        }
        acc.unitCounts.set(uApi, (acc.unitCounts.get(uApi) ?? 0) + 1)
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
        const star = rec.us?.[i]
        if (star && star > 0) {
          const list = acc.unitStarLists.get(uApi) ?? []
          list.push(star)
          acc.unitStarLists.set(uApi, list)
        }
      }

      // 紋章マルチセット: emblems 辞書に存在 かつ 付与トレイト（変種含む）が発動中。
      const recTraitKeys = new Set(Object.keys(rec.t))
      const activeEmblems: string[] = []
      for (let k = 0; k < rec.e.length; k++) {
        const eApi = rec.e[k]
        const emb = staticData.emblems.get(eApi)
        if (!emb) {
          unresolvedEmblemNames.add(eApi)
          continue
        }
        if (!emb.traitApis.some((a) => recTraitKeys.has(a))) continue
        activeEmblems.push(eApi)

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
      activeEmblems.sort()
      const rowKey = activeEmblems.join('|')
      let row = acc.rows.get(rowKey)
      if (!row) {
        row = { emblems: activeEmblems, n: 0, top4: 0, win: 0, p: 0 }
        acc.rows.set(rowKey, row)
      }
      row.n++
      if (rec.p <= 4) row.top4++
      if (rec.p === 1) row.win++
      row.p += rec.p
    }

    return { clusters: [...map.values()], noClusterKey, excludedUnresolvedTrait }
  }

  // 7. PreComp 化（apiName ベース）。出力で参照する apiName を used 集合へ収集。
  const usedTraitApis = new Set<string>()
  const usedUnitApis = new Set<string>()
  const usedEmblemApis = new Set<string>()
  const usedItemApis = new Set<string>()

  interface PreComp {
    traitApis: string[]
    n: number
    top4: number
    win: number
    traitModeStyle: Map<string, number>
    synergies: [string, number, number][] // [traitApi, modeStyle, modeCount] 過半数で発動の代表シナジー
    unitApis: string[]
    unitStarByApi: Map<string, number> // unitApi → 代表スター(mode)

    rows: { emblems: string[]; n: number; top4: number; win: number; p: number }[]
    holders: [string, string, number][] // [emblemApi, holderApi, count]
    unitItems: [string, string, number][] // [unitApi, itemApi, count]
  }

  const MIN_OUTPUT_N = 3 // 合計サンプルがこの未満のクラスタは出力しない（長尾枝刈り）
  const CARRY_UNITS = 4 // 推奨アイテムを出すユニット数（アイテム保持総数の上位）
  const ITEMS_PER_UNIT = 3 // ユニットごとの推奨アイテム数
  const SYNERGY_MIN_FREQ = 0.5 // クラスタ内でこの割合以上発動しているトレイトを代表シナジーとする

  function accToPreComp(acc: ClusterAcc, repUnitCount: number): PreComp {
    const traitModeStyle = new Map<string, number>()
    for (const tApi of acc.traitApis) {
      traitModeStyle.set(tApi, modeMaxNumber(acc.styleLists.get(tApi) ?? []) ?? 0)
      usedTraitApis.add(tApi)
    }

    // 代表シナジー: クラスタの過半数(>=SYNERGY_MIN_FREQ)で発動しているトレイト。
    // modeCount は最頻ユニット数（tc が無い旧データは 0）。
    const synergies: [string, number, number][] = []
    for (const [tApi, list] of acc.styleLists) {
      if (list.length / acc.n >= SYNERGY_MIN_FREQ) {
        const modeCount = modeMaxNumber(acc.countLists.get(tApi) ?? []) ?? 0
        synergies.push([tApi, modeMaxNumber(list) ?? 0, modeCount])
        usedTraitApis.add(tApi)
      }
    }

    // 代表ユニット（出現頻度降順、同数は名前昇順）。バケットごとに repUnitCount 件。
    const topUnits = [...acc.unitCounts.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        const na = staticData.units.get(a[0])!.name
        const nb = staticData.units.get(b[0])!.name
        return na < nb ? -1 : na > nb ? 1 : a[0] < b[0] ? -1 : 1
      })
      .slice(0, repUnitCount)
      .map((e) => e[0])
    for (const u of topUnits) usedUnitApis.add(u)

    // 代表ユニットの代表スターレベル（mode）。
    const unitStarByApi = new Map<string, number>()
    for (const uApi of topUnits) {
      const ms = modeMaxNumber(acc.unitStarLists.get(uApi) ?? [])
      if (ms) unitStarByApi.set(uApi, ms)
    }

    // 紋章ごとの最頻装備ユニット。
    const holders: [string, string, number][] = []
    for (const [emblemApi, hc] of acc.holderCounts) {
      let bestUnit: string | undefined
      let bestCount = -1
      for (const [unitApi, count] of hc) {
        if (
          count > bestCount ||
          (count === bestCount &&
            bestUnit !== undefined &&
            staticData.units.get(unitApi)!.name < staticData.units.get(bestUnit)!.name)
        ) {
          bestCount = count
          bestUnit = unitApi
        }
      }
      if (bestUnit !== undefined) {
        holders.push([emblemApi, bestUnit, bestCount])
        usedUnitApis.add(bestUnit)
      }
    }

    // 推奨アイテム: アイテム保持総数が多い上位 CARRY_UNITS ユニット × 上位 ITEMS_PER_UNIT アイテム。
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

    return {
      traitApis: acc.traitApis,
      n: acc.n,
      top4: acc.top4,
      win: acc.win,
      traitModeStyle,
      synergies,
      unitApis: topUnits,
      unitStarByApi,
      rows: [...acc.rows.values()],
      holders,
      unitItems,
    }
  }

  /** レコード集合 → 出力対象 PreComp 群（n>=MIN_OUTPUT_N で枝刈り）。 */
  function bucketPreComps(records: LoadedRecord[], repUnitCount: number): PreComp[] {
    const { clusters } = buildClusters(records)
    return clusters.filter((c) => c.n >= MIN_OUTPUT_N).map((c) => accToPreComp(c, repUnitCount))
  }

  // 全体バケット（代表ユニット10）とレベル別バケット（代表ユニット=レベル）。
  const allResult = buildClusters(target)
  const allPreComps = allResult.clusters
    .filter((c) => c.n >= MIN_OUTPUT_N)
    .map((c) => accToPreComp(c, 10))
  const LEVELS = [7, 8, 9, 10] as const
  const levelPreComps: Record<string, PreComp[]> = {}
  for (const lv of LEVELS) {
    const recs = target.filter((lr) => lr.rec.lv === lv)
    levelPreComps[String(lv)] = bucketPreComps(recs, Math.min(lv, 10))
  }

  console.log(`クラスタ数（全体）: ${allResult.clusters.length}（出力 ${allPreComps.length}）`)
  console.log(`クラスタ対象外（キートレイト0, 全体）: ${allResult.noClusterKey}`)
  console.log(`未解決トレイトで除外したレコード（全体）: ${allResult.excludedUnresolvedTrait}`)

  // 「e に出現し辞書解決できた全紋章」を target レコードから収集（発動の有無に関わらず）。
  for (const lr of target) {
    let hasUnresolvedTrait = false
    for (const tApi of Object.keys(lr.rec.t)) {
      if (!staticData.traits.has(tApi)) {
        hasUnresolvedTrait = true
        break
      }
    }
    if (hasUnresolvedTrait) continue
    if (Object.values(lr.rec.t).every((s) => s < config.clusterMinStyle)) continue
    for (const eApi of lr.rec.e) {
      if (staticData.emblems.has(eApi)) usedEmblemApis.add(eApi)
    }
  }

  // emblems の traitApi 参照先トレイトも used に追加。
  for (const eApi of usedEmblemApis) {
    const emb = staticData.emblems.get(eApi)
    if (emb) usedTraitApis.add(emb.traitApi)
  }

  // 8. インターン配列を決定的順序で構築（全バケット横断で1回）。
  const traitApisSorted = [...usedTraitApis].sort((a, b) => {
    const na = staticData.traits.get(a)!.name
    const nb = staticData.traits.get(b)!.name
    return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  const traitIndex = new Map<string, number>()
  const traitsOut: TraitInfo[] = traitApisSorted.map((api, i) => {
    traitIndex.set(api, i)
    const t = staticData.traits.get(api)!
    return { api, name: t.name, nameJa: t.nameJa, icon: t.icon }
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
    return { api, name: u.name, nameJa: u.nameJa, cost: u.cost, icon: u.icon, code: u.code }
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
    return { api, name: e.name, nameJa: e.nameJa, trait: traitIndex.get(e.traitApi)!, icon: e.icon }
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

  // 9. PreComp → CompStats（intern index 化）。
  function toComp(pc: PreComp): CompStats {
    const traitPairs: [number, number][] = pc.traitApis
      .map((api): [number, number] => [traitIndex.get(api)!, pc.traitModeStyle.get(api) ?? 0])
      .sort((a, b) => a[0] - b[0])

    // label/labelJa: modeStyle 降順・同値は英語名昇順で順序を一意化し、各言語で連結。
    const labelParts = pc.traitApis
      .map((api) => ({
        name: staticData.traits.get(api)!.name,
        nameJa: staticData.traits.get(api)!.nameJa,
        style: pc.traitModeStyle.get(api) ?? 0,
      }))
      .sort((a, b) => {
        if (b.style !== a.style) return b.style - a.style
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
      })
    const label = labelParts.map((p) => p.name).join(' / ')
    const labelJa = labelParts.map((p) => p.nameJa).join(' / ')

    // synergies: 代表シナジー [traitIdx, modeStyle, modeCount]。style 降順→トレイト名昇順。
    const synergies: [number, number, number][] = pc.synergies
      .map(([api, style, count]): [number, number, number] => [traitIndex.get(api)!, style, count])
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        const na = traitsOut[a[0]].name
        const nb = traitsOut[b[0]].name
        return na < nb ? -1 : na > nb ? 1 : 0
      })

    const unitIdxs = pc.unitApis
      .map((api) => unitIndex.get(api)!)
      .sort((a, b) => {
        const ua = unitsOut[a]
        const ub = unitsOut[b]
        if (ua.cost !== ub.cost) return ua.cost - ub.cost
        return ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : a - b
      })
    // units と同順の代表スター。
    const unitStars = unitIdxs.map((idx) => pc.unitStarByApi.get(unitsOut[idx].api) ?? 0)

    const rows: EmblemRow[] = pc.rows
      .map((r): EmblemRow => {
        const e = r.emblems.map((api) => emblemIndex.get(api)!).sort((x, y) => x - y)
        return { e, n: r.n, top4: r.top4, win: r.win, p: r.p }
      })
      .sort((a, b) => {
        if (a.e.length !== b.e.length) return a.e.length - b.e.length
        for (let i = 0; i < a.e.length; i++) if (a.e[i] !== b.e[i]) return a.e[i] - b.e[i]
        return 0
      })

    const holders: [number, number, number][] = pc.holders
      .map(([emblemApi, unitApi, count]): [number, number, number] => [
        emblemIndex.get(emblemApi)!,
        unitIndex.get(unitApi)!,
        count,
      ])
      .sort((a, b) => a[0] - b[0])

    const unitItems: [number, number, number][] = pc.unitItems
      .map(([unitApi, itemApi, count]): [number, number, number] => [
        unitIndex.get(unitApi)!,
        itemIndex.get(itemApi)!,
        count,
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])

    return {
      traits: traitPairs,
      synergies,
      label,
      labelJa,
      units: unitIdxs,
      unitStars,
      n: pc.n,
      top4: pc.top4,
      win: pc.win,
      rows,
      holders,
      unitItems,
    }
  }

  // 8. 出力
  const comps: CompStats[] = allPreComps.map(toComp).sort((a, b) => b.n - a.n)
  const compsByLevel: Record<string, CompStats[]> = {}
  for (const lv of LEVELS) {
    compsByLevel[String(lv)] = levelPreComps[String(lv)].map(toComp).sort((a, b) => b.n - a.n)
  }

  const byRoute: Record<string, number> = {}
  const uniqueMatches = new Set<string>()
  for (const lr of target) {
    byRoute[lr.route] = (byRoute[lr.route] ?? 0) + 1
    uniqueMatches.add(lr.rec.m)
  }

  const out: StatsFile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    patch: targetPatch,
    tftPatch: config.tftPatchLabels[targetPatch] ?? targetPatch,
    setNumber: staticData.setNumber,
    config: {
      minStyle: config.clusterMinStyle,
      minSampleDefault: config.minSampleDefault,
      emblemMinSample: config.emblemMinSample,
    },
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
    compsByLevel,
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(out))

  // 9. ログ
  const sizeBytes = statSync(OUT_PATH).size
  const sizeKB = (sizeBytes / 1024).toFixed(1)
  console.log('--- 集計サマリ ---')
  console.log(`TFTパッチ表記: ${out.tftPatch}（内部 ${targetPatch}）`)
  console.log(`comps 数（全体）: ${comps.length}`)
  console.log(
    `レベル別 comps: ${LEVELS.map((lv) => `lv${lv}=${compsByLevel[String(lv)].length}`).join(' ')}`,
  )
  console.log(
    `インターン: traits=${traitsOut.length} emblems=${emblemsOut.length} units=${unitsOut.length} items=${itemsOut.length}`,
  )
  console.log(`totals: matches=${uniqueMatches.size} participants=${target.length} byRoute=${JSON.stringify(byRoute)}`)
  console.log(`出力: ${OUT_PATH} (${sizeKB} KB)`)

  // 警告
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
