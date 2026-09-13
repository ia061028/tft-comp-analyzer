// Phase 3: data/state/records/*.ndjson → public/data/stats.json（＋パッチ別 stats-{patch}.json）
// 構成 = 盤面ユニット集合が完全一致するレコード群（クラスタリングはしない）。
// 各構成に「紋章活用シグネチャ(sig)」を持たせ、選択紋章に応じた活用判定はランタイムで行う。
//
// 集計ロジック本体は aggregate-core.ts（純関数）に分離。ここは I/O とログの薄いエントリ。
//
// 出力は「パッチビュー」ごとに1ファイル:
//   - 既定ビュー（ヒステリシス選定パッチ）  → stats.json（フロントが最初に読む）
//   - その他のパッチ / 全パッチ合算("all") → stats-{key}.json
// 全ファイルに同じ `patches` 一覧を埋め込み、フロントはそれを見て切り替え先を fetch する。

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'
import { compareVersions, resolvePatch, planPatchViews } from './patches.ts'
import { getStaticData, type StaticData } from './cdragon.ts'
import type { ParticipantRecord, WireStatsFile, PatchIndexEntry } from '../shared/types.ts'
import { type LoadedRecord, dedupeRecords, buildStats, pickTargetSet } from './aggregate-core.ts'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const RECORDS_DIR = join(ROOT, 'data', 'state', 'records')
const OUT_DIR = join(ROOT, 'public', 'data')
const DEFAULT_FILE = 'stats.json'
/** パッチビューのファイル名。既定ビューは stats.json、それ以外は stats-{key}.json。 */
const VIEW_FILE_RE = /^stats-[^/\\]+\.json$/

function viewFileName(key: string, defaultKey: string): string {
  return key === defaultKey ? DEFAULT_FILE : `stats-${key}.json`
}

/** 内部パッチキー → 表示用 TFT 表記。patchSchedule 由来のキーは TFT 表記そのもの。 */
function tftLabelOf(patch: string): string | undefined {
  if (config.tftPatchLabels[patch] !== undefined) return config.tftPatchLabels[patch]
  if (config.patchSchedule.some((e) => e.patch === patch)) return patch
  return undefined
}

/**
 * 既存ファイルと「generatedAt を除いて」一致するか。
 * buildStats は純関数で、出力は generatedAt を除き入力レコードのみに決定的に依存する
 * （ハッシュ順序ゆらぎ等の非決定性はない）。一致すれば書き換えをスキップし、
 * generatedAt だけが変わる無意味な main コミット/デプロイを防ぐ。
 */
function isUnchanged(path: string, out: WireStatsFile): boolean {
  if (!existsSync(path)) return false
  try {
    const prev = JSON.parse(readFileSync(path, 'utf8')) as WireStatsFile
    return JSON.stringify({ ...prev, generatedAt: '' }) === JSON.stringify({ ...out, generatedAt: '' })
  } catch {
    // 既存ファイルが壊れている等でパース不能なら比較を諦め、通常どおり書き直す。
    return false
  }
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
  const { deduped, dupSkipped } = dedupeRecords(all)
  console.log(`重複ガード: ${dupSkipped} 件スキップ → ${deduped.length} レコード`)

  // 2b. パッチ割り当て。game_version 由来の v が合成キー（"18.0"）なら、game_datetime を
  // config.patchSchedule に当てて実パッチ（"18.1" / "18.2" …）へ置き換える。
  let resolvedCount = 0
  const withPatch: LoadedRecord[] = deduped.map((lr) => {
    const v = resolvePatch(lr.rec.v, lr.rec.ts, config.patchSchedule)
    if (v === lr.rec.v) return lr
    resolvedCount++
    return { rec: { ...lr.rec, v }, route: lr.route }
  })
  console.log(`パッチ割り当て（日時ベース）: ${resolvedCount} レコードを patchSchedule で実パッチへ解決`)

  // 3. セット絞り込み。tft_set_number を持つレコードがあれば最頻セットに絞る。
  // s を持たない旧レコードは残す（既存レコードは全て s 無しであり、落とすと集計が空になる）。
  let inSet = withPatch
  const targetSet = pickTargetSet(withPatch)
  if (targetSet !== null) {
    const before = inSet.length
    inSet = inSet.filter((lr) => lr.rec.s === targetSet || lr.rec.s === undefined)
    const withS = inSet.filter((lr) => lr.rec.s === targetSet).length
    console.log(
      `対象セット（tft_set_number 最頻値）: ${targetSet} — ` +
        `${before} → ${inSet.length} レコード（s=${targetSet}: ${withS}, s無し: ${inSet.length - withS}）`,
    )
  } else {
    console.log('対象セット: 判定不可（tft_set_number を持つレコードなし）。パッチのみで絞り込む。')
  }

  // 4. パッチ分布とビュー選定（既定 = ヒステリシス: ユニークマッチ数 >= threshold の最新パッチ）
  const patchRecordCounts = new Map<string, number>()
  const patchMatchSets = new Map<string, Set<string>>()
  for (const lr of inSet) {
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
  const { defaultKey, views } = planPatchViews(matchCountByPatch, config.patchSwitchThreshold)
  if (defaultKey === null) {
    console.error('対象パッチを選定できません（レコードが空）。')
    process.exit(1)
  }
  console.log(
    `既定パッチ（ヒステリシス選定）: ${defaultKey} / 出力ビュー: ${views.map((v) => v.key).join(', ')}`,
  )

  // 5. 静的データ（セット共通なので、対象セットの全レコードのトレイト集合から1回だけ解決）
  const recordTraitNames = new Set<string>()
  for (const lr of inSet) for (const k of Object.keys(lr.rec.t)) recordTraitNames.add(k)
  const staticData: StaticData = await getStaticData(recordTraitNames)
  const resolvedTraits = [...recordTraitNames].filter((t) => staticData.traits.has(t)).length
  const coverage =
    recordTraitNames.size === 0 ? 100 : (resolvedTraits / recordTraitNames.size) * 100
  console.log(
    `選定セット: ${staticData.setNumber}, トレイトカバレッジ: ${coverage.toFixed(1)}% ` +
      `(${recordTraitNames.size} 種中 ${resolvedTraits} 解決)`,
  )

  // 6. ビューごとに集計。patches 一覧は全ファイル共通なので先に確定する。
  const generatedAt = new Date().toISOString()
  const unlabeled = new Set<string>()
  const labelOf = (patch: string): string => {
    const label = tftLabelOf(patch)
    if (label === undefined) unlabeled.add(patch)
    return label ?? patch
  }
  const viewLabel = (patches: string[]): string =>
    patches.length === 1 ? labelOf(patches[0]) : `${labelOf(patches[0])}–${labelOf(patches[patches.length - 1])}`

  const index: PatchIndexEntry[] = views.map((view) => ({
    key: view.key,
    label: viewLabel(view.patches),
    file: viewFileName(view.key, defaultKey),
    matches: view.patches.reduce((s, p) => s + (matchCountByPatch.get(p) ?? 0), 0),
  }))

  const outputs: { file: string; out: WireStatsFile }[] = []
  const unresolvedTraitNames = new Set<string>()
  const unresolvedUnitNames = new Set<string>()
  const unresolvedEmblemNames = new Set<string>()
  for (const view of views) {
    const include = new Set(view.patches)
    const target = inSet.filter((lr) => include.has(lr.rec.v))
    const { out, diag } = buildStats(target, staticData, {
      targetPatch: view.key,
      tftPatch: viewLabel(view.patches),
      generatedAt,
    })
    out.patches = index
    const file = viewFileName(view.key, defaultKey)
    outputs.push({ file, out })
    console.log(
      `[${view.key}] 盤面グループ: ${diag.boardGroupCount}` +
        `（盤面なし除外 ${diag.noBoard}, 未解決トレイト除外 ${diag.excludedUnresolvedTrait}）` +
        ` comps=${out.comps.length} matches=${out.totals.matches} → ${file}`,
    )
    for (const n of diag.unresolvedTraitNames) unresolvedTraitNames.add(n)
    for (const n of diag.unresolvedUnitNames) unresolvedUnitNames.add(n)
    for (const n of diag.unresolvedEmblemNames) unresolvedEmblemNames.add(n)
  }

  // 7. 書き出し。実質差分のないファイルは触らず、今回のビューに無い旧 stats-*.json は消す。
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const written: string[] = []
  const skipped: string[] = []
  for (const { file, out } of outputs) {
    const path = join(OUT_DIR, file)
    if (isUnchanged(path, out)) {
      skipped.push(file)
      continue
    }
    writeFileSync(path, JSON.stringify(out))
    written.push(file)
  }
  const current = new Set(outputs.map((o) => o.file))
  const removed: string[] = []
  for (const f of readdirSync(OUT_DIR)) {
    if (VIEW_FILE_RE.test(f) && !current.has(f)) {
      unlinkSync(join(OUT_DIR, f))
      removed.push(f)
    }
  }

  // 8. ログ
  console.log('--- 集計サマリ ---')
  console.log(`既定パッチ: ${labelOf(defaultKey)}（内部 ${defaultKey}） → ${DEFAULT_FILE}`)
  for (const { file, out } of outputs) {
    const sizeKB = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(1)
    const totalSigs = out.comps.reduce((s, c) => s + c.g.length, 0)
    console.log(
      `  ${file}: patch=${out.tftPatch} comps=${out.comps.length} sig=${totalSigs} ` +
        `matches=${out.totals.matches} participants=${out.totals.participants} (${sizeKB} KB)`,
    )
  }
  const first = outputs[0].out
  console.log(
    `インターン(${outputs[0].file}): traits=${first.traits.length} emblems=${first.emblems.length} units=${first.units.length} items=${first.items.length}`,
  )
  if (written.length === 0) {
    console.log('出力: 実質差分なし（generatedAt のみ）。全ファイルの書き換えをスキップ。')
  } else {
    console.log(`出力: 書き換え ${written.join(', ')}${skipped.length ? ` / 差分なし ${skipped.join(', ')}` : ''}`)
  }
  if (removed.length) console.log(`削除（今回のビューに無い旧ファイル）: ${removed.join(', ')}`)
  const totalBytes = outputs.reduce((s, o) => s + statSync(join(OUT_DIR, o.file)).size, 0)
  console.log(`出力先: ${OUT_DIR} (${outputs.length} ファイル, 計 ${(totalBytes / 1024).toFixed(1)} KB)`)

  const warnLines: string[] = []
  for (const w of staticData.warnings) warnLines.push(`[静的データ] ${w}`)
  for (const p of [...unlabeled].sort(compareVersions)) {
    warnLines.push(
      `[パッチ表記] 内部パッチ ${p} が config.tftPatchLabels / patchSchedule に未登録のため、` +
        `TFT表記にフォールバック（${p} をそのまま表示）。新セット/新パッチなら1行追加すること。`,
    )
  }
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
