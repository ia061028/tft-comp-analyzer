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

  // 警告集計用（種類ごとのユニーク名）
  const unresolvedTraitNames = new Set<string>()
  const unresolvedUnitNames = new Set<string>()
  const unresolvedEmblemNames = new Set<string>()
  let recordsExcludedUnresolvedTrait = 0
  let noClusterKey = 0

  // 5/6. クラスタリング & クラスタ内集計
  interface ClusterAcc {
    traitApis: string[] // キートレイト apiName（ソート済み）
    n: number
    top4: number
    win: number
    // トレイト apiName → style 値リスト（最頻 style 算出用）
    styleLists: Map<string, number[]>
    // unit apiName → 出現回数
    unitCounts: Map<string, number>
    // 紋章マルチセット（emblem apiName ソート済み JSON）→ 集計（p=順位合計）
    rows: Map<string, { emblems: string[]; n: number; top4: number; win: number; p: number }>
    // 紋章 apiName → 装備ユニット(character_id) → 回数（holder 集計用、eh ありレコードのみ）
    holderCounts: Map<string, Map<string, number>>
  }
  const clusters = new Map<string, ClusterAcc>()

  for (const lr of target) {
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
      recordsExcludedUnresolvedTrait++
      continue
    }

    // クラスタキー: style>=minStyle のトレイトのうち、スタイル降順（同点は apiName 昇順）で
    // 上位 clusterMaxKeyTraits 件を採用し、apiName 昇順で連結（決定的）。
    // 全ゴールドをキーにすると細分化しすぎるため、定義的な上位トレイトのみで集約する。
    const goldTraits = Object.entries(rec.t).filter(([, style]) => style >= config.clusterMinStyle)
    if (goldTraits.length === 0) {
      noClusterKey++
      continue
    }
    goldTraits.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    const keyTraits = goldTraits.slice(0, config.clusterMaxKeyTraits).map(([tApi]) => tApi)
    keyTraits.sort()
    const clusterKey = keyTraits.join('|')

    let acc = clusters.get(clusterKey)
    if (!acc) {
      acc = {
        traitApis: keyTraits,
        n: 0,
        top4: 0,
        win: 0,
        styleLists: new Map(),
        unitCounts: new Map(),
        rows: new Map(),
        holderCounts: new Map(),
      }
      clusters.set(clusterKey, acc)
    }

    acc.n++
    if (rec.p <= 4) acc.top4++
    if (rec.p === 1) acc.win++

    // キートレイトの style を蓄積
    for (const tApi of keyTraits) {
      const list = acc.styleLists.get(tApi) ?? []
      list.push(rec.t[tApi])
      acc.styleLists.set(tApi, list)
    }

    // ユニット出現（解決できるものだけ。未解決は警告カウント、レコードは除外しない）
    for (const uApi of rec.u) {
      if (!staticData.units.has(uApi)) {
        unresolvedUnitNames.add(uApi)
        continue
      }
      acc.unitCounts.set(uApi, (acc.unitCounts.get(uApi) ?? 0) + 1)
    }

    // 紋章マルチセット: emblems 辞書に存在 かつ traitApi が当該レコードの t キーに含まれる
    // （= シナジー発動中）。t のキーは発動トレイト全体（style 不問）。
    const recTraitKeys = new Set(Object.keys(rec.t))
    const activeEmblems: string[] = []
    for (let k = 0; k < rec.e.length; k++) {
      const eApi = rec.e[k]
      const emb = staticData.emblems.get(eApi)
      if (!emb) {
        unresolvedEmblemNames.add(eApi)
        continue
      }
      // 発動判定: 紋章の付与トレイト（変種含む全集合）のいずれかが当該レコードで発動中なら採用。
      if (!emb.traitApis.some((a) => recTraitKeys.has(a))) continue
      activeEmblems.push(eApi)

      // 装備ユニット（holder）を集計。eh は e と同インデックス。解決できるユニットのみ。
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

  console.log(`クラスタ数: ${clusters.size}`)
  console.log(`クラスタ対象外（キートレイト0）: ${noClusterKey}`)
  console.log(`未解決トレイトで除外したレコード: ${recordsExcludedUnresolvedTrait}`)

  // 7. インターン
  // 出力で参照される apiName を収集。
  const usedTraitApis = new Set<string>() // comps キー + emblems traitApi
  const usedUnitApis = new Set<string>()
  const usedEmblemApis = new Set<string>() // 対象レコードの e に出現し辞書解決できた全紋章

  // 各クラスタの units を「上位8種」に確定しつつ used 集合を埋める。
  interface PreComp {
    traitApis: string[]
    n: number
    top4: number
    win: number
    traitModeStyle: Map<string, number>
    unitApis: string[] // 上位8（コスト/名前順は後で）
    rows: { emblems: string[]; n: number; top4: number; win: number; p: number }[]
    // 紋章ごとの最頻装備ユニット: [emblemApi, holderApi, count]
    holders: [string, string, number][]
  }
  const preComps: PreComp[] = []

  for (const acc of clusters.values()) {
    // キートレイトの最頻 style
    const traitModeStyle = new Map<string, number>()
    for (const tApi of acc.traitApis) {
      const ms = modeMaxNumber(acc.styleLists.get(tApi) ?? [])
      traitModeStyle.set(tApi, ms ?? 0)
      usedTraitApis.add(tApi)
    }

    // 上位8ユニット（出現頻度降順、同数は名前昇順で決定的に）
    const unitEntries = [...acc.unitCounts.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      const na = staticData.units.get(a[0])!.name
      const nb = staticData.units.get(b[0])!.name
      return na < nb ? -1 : na > nb ? 1 : a[0] < b[0] ? -1 : 1
    })
    const topUnits = unitEntries.slice(0, 8).map((e) => e[0])
    for (const u of topUnits) usedUnitApis.add(u)

    // 紋章ごとの最頻装備ユニット（count 降順、同数は名前昇順で決定的に）。
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

    // 紋章 used 集合は「e に出現し辞書解決できた全紋章」（発動の有無に関わらず）なので、
    // rows（発動済みのみ）ではなく target レコードを別途走査して収集する（下のループ）。

    preComps.push({
      traitApis: acc.traitApis,
      n: acc.n,
      top4: acc.top4,
      win: acc.win,
      traitModeStyle,
      unitApis: topUnits,
      rows: [...acc.rows.values()],
      holders,
    })
  }

  // 「e に出現し辞書解決できた全紋章」を target レコードから直接収集（発動していなくても含める）。
  for (const lr of target) {
    // 対象レコードのみ（既にパッチフィルタ済み）。未解決トレイトで除外されたレコードは含めない方が自然だが、
    // 仕様は「対象レコードの e に出現し辞書解決できた全紋章」。除外レコードは集計に寄与しないため除く。
    let hasUnresolvedTrait = false
    for (const tApi of Object.keys(lr.rec.t)) {
      if (!staticData.traits.has(tApi)) {
        hasUnresolvedTrait = true
        break
      }
    }
    if (hasUnresolvedTrait) continue
    const keyTraits = Object.entries(lr.rec.t).filter(([, s]) => s >= config.clusterMinStyle)
    if (keyTraits.length === 0) continue
    for (const eApi of lr.rec.e) {
      if (staticData.emblems.has(eApi)) usedEmblemApis.add(eApi)
    }
  }

  // emblems の traitApi 参照先トレイトも used に追加。
  for (const eApi of usedEmblemApis) {
    const emb = staticData.emblems.get(eApi)
    if (emb) usedTraitApis.add(emb.traitApi)
  }

  // インターン配列を決定的順序で構築。
  // traits: 名前昇順（同名は apiName）。units: コスト昇順→名前昇順。emblems: 表示名昇順。
  const traitApisSorted = [...usedTraitApis].sort((a, b) => {
    const na = staticData.traits.get(a)!.name
    const nb = staticData.traits.get(b)!.name
    return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  const traitIndex = new Map<string, number>()
  const traitsOut: TraitInfo[] = traitApisSorted.map((api, i) => {
    traitIndex.set(api, i)
    const t = staticData.traits.get(api)!
    return { api, name: t.name, icon: t.icon }
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
    return { api, name: u.name, cost: u.cost, icon: u.icon }
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
    return { api, name: e.name, trait: traitIndex.get(e.traitApi)!, icon: e.icon }
  })

  // comps 構築
  const comps: CompStats[] = preComps.map((pc) => {
    // traits: [traitIdx, modeStyle] traitIdx 昇順
    const traitPairs: [number, number][] = pc.traitApis
      .map((api): [number, number] => [traitIndex.get(api)!, pc.traitModeStyle.get(api) ?? 0])
      .sort((a, b) => a[0] - b[0])

    // label: modeStyle 降順・同値は表示名昇順で " / " 連結
    const labelParts = pc.traitApis
      .map((api) => ({
        name: staticData.traits.get(api)!.name,
        style: pc.traitModeStyle.get(api) ?? 0,
      }))
      .sort((a, b) => {
        if (b.style !== a.style) return b.style - a.style
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
      })
    const label = labelParts.map((p) => p.name).join(' / ')

    // units: コスト昇順・同コストは表示名昇順の units 配列インデックス
    const unitIdxs = pc.unitApis
      .map((api) => unitIndex.get(api)!)
      .sort((a, b) => {
        const ua = unitsOut[a]
        const ub = unitsOut[b]
        if (ua.cost !== ub.cost) return ua.cost - ub.cost
        return ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : a - b
      })

    // rows: emblem 配列インデックスのソート済みマルチセット
    const rows: EmblemRow[] = pc.rows
      .map((r): EmblemRow => {
        const e = r.emblems.map((api) => emblemIndex.get(api)!).sort((x, y) => x - y)
        return { e, n: r.n, top4: r.top4, win: r.win, p: r.p }
      })
      .sort((a, b) => {
        // 決定的順序: 空マルチセット先頭、その後 e の辞書順。
        if (a.e.length !== b.e.length) return a.e.length - b.e.length
        for (let i = 0; i < a.e.length; i++) if (a.e[i] !== b.e[i]) return a.e[i] - b.e[i]
        return 0
      })

    // holders: [emblemIdx, unitIdx, count]。emblemIdx 昇順で決定的に。
    const holders: [number, number, number][] = pc.holders
      .map(([emblemApi, unitApi, count]): [number, number, number] => [
        emblemIndex.get(emblemApi)!,
        unitIndex.get(unitApi)!,
        count,
      ])
      .sort((a, b) => a[0] - b[0])

    return {
      traits: traitPairs,
      label,
      units: unitIdxs,
      n: pc.n,
      top4: pc.top4,
      win: pc.win,
      rows,
      holders,
    }
  })

  // 8. 出力
  comps.sort((a, b) => b.n - a.n)

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
    comps,
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(out))

  // 9. ログ
  const sizeBytes = statSync(OUT_PATH).size
  const sizeKB = (sizeBytes / 1024).toFixed(1)
  console.log('--- 集計サマリ ---')
  console.log(`comps 数: ${comps.length}`)
  console.log(
    `インターン: traits=${traitsOut.length} emblems=${emblemsOut.length} units=${unitsOut.length}`,
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
