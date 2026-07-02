// Phase 3: data/state/records/*.ndjson → public/data/stats.json
// 構成 = 盤面ユニット集合が完全一致するレコード群（クラスタリングはしない）。
// 各構成に「紋章活用シグネチャ(sig)」を持たせ、選択紋章に応じた活用判定はランタイムで行う。
//
// 集計ロジック本体は aggregate-core.ts（純関数）に分離。ここは I/O とログの薄いエントリ。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'
import { pickTargetPatch, compareVersions } from './patches.ts'
import { getStaticData, type StaticData } from './cdragon.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import { type LoadedRecord, dedupeRecords, buildStats } from './aggregate-core.ts'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const RECORDS_DIR = join(ROOT, 'data', 'state', 'records')
const OUT_DIR = join(ROOT, 'public', 'data')
const OUT_PATH = join(OUT_DIR, 'stats.json')

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
  const { deduped, dupSkipped } = dedupeRecords(all)
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

  // 5-8. 盤面グルーピング〜シグネチャ集計〜インターン〜Wire 圧縮（純関数）。
  const { out, diag } = buildStats(target, staticData, {
    targetPatch,
    tftPatch: config.tftPatchLabels[targetPatch] ?? targetPatch,
    generatedAt: new Date().toISOString(),
  })

  console.log(
    `盤面グループ: ${diag.boardGroupCount}（盤面なし除外 ${diag.noBoard}, 未解決トレイト除外 ${diag.excludedUnresolvedTrait}）`,
  )

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(out))

  // 9. ログ
  const sizeBytes = statSync(OUT_PATH).size
  const sizeKB = (sizeBytes / 1024).toFixed(1)
  const totalSigs = out.comps.reduce((s, c) => s + c.g.length, 0)
  console.log('--- 集計サマリ ---')
  console.log(`TFTパッチ表記: ${out.tftPatch}（内部 ${targetPatch}）`)
  console.log(`comps 数: ${out.comps.length}, sig 行合計: ${totalSigs}`)
  console.log(
    `インターン: traits=${out.traits.length} emblems=${out.emblems.length} units=${out.units.length} items=${out.items.length}`,
  )
  console.log(
    `totals: matches=${out.totals.matches} participants=${out.totals.participants} byRoute=${JSON.stringify(out.totals.byRoute)}`,
  )
  console.log(`出力: ${OUT_PATH} (${sizeKB} KB)`)

  const warnLines: string[] = []
  for (const w of staticData.warnings) warnLines.push(`[静的データ] ${w}`)
  if (parseFailures > 0) warnLines.push(`[parse失敗] ${parseFailures} 行`)
  if (diag.unresolvedTraitNames.size > 0) {
    warnLines.push(
      `[未解決トレイト] ${diag.unresolvedTraitNames.size} 種（該当レコード除外）: ${[...diag.unresolvedTraitNames].sort().join(', ')}`,
    )
  }
  if (diag.unresolvedUnitNames.size > 0) {
    warnLines.push(
      `[未解決ユニット] ${diag.unresolvedUnitNames.size} 種（該当ユニットのみ無視）: ${[...diag.unresolvedUnitNames].sort().join(', ')}`,
    )
  }
  if (diag.unresolvedEmblemNames.size > 0) {
    warnLines.push(
      `[未解決紋章] ${diag.unresolvedEmblemNames.size} 種（該当紋章のみ無視）: ${[...diag.unresolvedEmblemNames].sort().join(', ')}`,
    )
  }
  if (diag.tcMissingRecords > 0) {
    warnLines.push(
      `[tc欠落] ${diag.tcMissingRecords} レコード（tc なしのため紋章シグネチャ集計から除外）`,
    )
  }
  if (diag.belowMinBreakpoint > 0) {
    warnLines.push(
      `[最小BP未満] ${diag.belowMinBreakpoint} 紋章インスタンス（盤面実効数が最小ブレークポイント未満のため活用に数えない）`,
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
