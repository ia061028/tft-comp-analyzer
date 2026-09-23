// Phase 3: data/state/records/ → public/data/stats.json（＋パッチ別 stats-{patch}.json）
// 構成 = 盤面ユニット集合が完全一致するレコード群（クラスタリングはしない）。
// 各構成に「紋章活用シグネチャ(sig)」を持たせ、選択紋章に応じた活用判定はランタイムで行う。
//
// 集計ロジック本体は aggregate-core.ts（純関数）に分離。ここは I/O とログの薄いエントリ。
//
// レコードは records/{route}.ndjson（アクティブ）と records/{route}/*.ndjson.gz（封印シャード）を
// ストリーミングで3回読む。全件をメモリに展開しない:
//   パス A（走査）: パッチ・セット分布、トレイト名、ビュー選定
//   パス B（盤面カウント）: 構成キーごとのパッチ別件数（n>=MIN_OUTPUT_N の盤面だけ accumulate するため）
//   パス C（集計）: ビューごとの StatsBuilder に取り込み
//
// 出力は「パッチビュー」ごとに1ファイル:
//   - 既定ビュー（ヒステリシス選定パッチ）  → stats.json（フロントが最初に読む）
//   - その他のパッチ / 全パッチ合算("all") → stats-{key}.json
// 全ファイルに同じ `patches` 一覧を埋め込み、フロントはそれを見て切り替え先を fetch する。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { config, KNOWN_ROUTES } from './config.ts'
import { compareVersions, resolvePatch, planPatchViews, retentionFloor } from './patches.ts'
import { getStaticData, type StaticData } from './cdragon.ts'
import type { ParticipantRecord, WireStatsFile, PatchIndexEntry } from '../shared/types.ts'
import {
  classifyRecord,
  createStatsBuilder,
  serializeStatsFile,
  pickTargetSetFromCounts,
  MIN_OUTPUT_N,
  type StatsBuilder,
} from './aggregate-core.ts'
import { listRouteShards, forEachRecord } from './shards.ts'

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
 * 集計は純関数で、出力は generatedAt を除き入力レコードのみに決定的に依存する。
 * 一致すれば書き換えをスキップし、generatedAt だけが変わる無意味な main コミット/デプロイを防ぐ。
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

const heapMB = (): string => (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0) + 'MB'
const secSince = (t0: number): string => ((Date.now() - t0) / 1000).toFixed(1) + 's'

async function main(): Promise<void> {
  // 1. シャード列挙
  if (!existsSync(RECORDS_DIR)) {
    console.error(`records ディレクトリが存在しません: ${RECORDS_DIR}`)
    process.exit(1)
  }
  const routes = listRouteShards(RECORDS_DIR, KNOWN_ROUTES, (m) => console.warn(`  警告: ${m}`))
  if (routes.size === 0) {
    console.error('records にルートのファイルが見つかりません。')
    process.exit(1)
  }
  for (const [route, rs] of routes) {
    const gz = rs.sealed.reduce((s, x) => s + x.gzBytes, 0)
    console.log(
      `[${route}] 封印シャード=${rs.sealed.length} (gz ${(gz / 1024 / 1024).toFixed(1)}MB) ` +
        `アクティブ=${rs.active ? (statSync(rs.active).size / 1024 / 1024).toFixed(1) + 'MB' : 'なし'}`,
    )
  }
  const schedule = config.patchSchedule
  const nowMs = Date.now()

  // 2. パス A（走査）: セット分布、(セット, パッチ) ごとのユニークマッチ、トレイト名、重複検出。
  let t0 = Date.now()
  const setCounts = new Map<number, number>()
  const matchSets = new Map<string, Set<string>>() // `${set ?? '-'}|${patch}` → マッチID集合
  const traitNamesBySet = new Map<string, Set<string>>() // `${set ?? '-'}` → トレイト名集合
  const allMatches = new Set<string>()
  let duplicateMatchGroups = 0
  let prevM = ''
  const scan = await forEachRecord(routes.values(), (rec) => {
    const setKey = typeof rec.s === 'number' ? String(rec.s) : '-'
    if (typeof rec.s === 'number') setCounts.set(rec.s, (setCounts.get(rec.s) ?? 0) + 1)
    const patch = resolvePatch(rec.v, rec.ts, schedule)
    const key = `${setKey}|${patch}`
    let ms = matchSets.get(key)
    if (!ms) {
      ms = new Set()
      matchSets.set(key, ms)
    }
    ms.add(rec.m)
    let tn = traitNamesBySet.get(setKey)
    if (!tn) {
      tn = new Set()
      traitNamesBySet.set(setKey, tn)
    }
    for (const k of Object.keys(rec.t)) tn.add(k)
    // 同じマッチが非連続に現れたら重複（collect は seen を先に書くので通常は起きない）。
    if (rec.m !== prevM) {
      if (allMatches.has(rec.m)) duplicateMatchGroups++
      allMatches.add(rec.m)
      prevM = rec.m
    }
  })
  console.log(
    `パス A（走査）: ${scan.records} レコード / ${scan.files} ファイル（parse失敗 ${scan.parseFailures}） ${secSince(t0)} heap=${heapMB()}`,
  )
  if (scan.records === 0) {
    console.error('レコードが空です。')
    process.exit(1)
  }

  // 3. セット絞り込みと保持下限パッチ。s を持たない旧レコードは残す。
  const targetSet = pickTargetSetFromCounts(setCounts)
  const floor = targetSet === null ? null : retentionFloor(schedule, targetSet, config.patchesToKeep, nowMs)
  const inSetKeys = new Set<string>(['-'])
  if (targetSet !== null) inSetKeys.add(String(targetSet))
  const inScope = (rec: ParticipantRecord, patch: string): boolean =>
    (targetSet === null || rec.s === undefined || rec.s === targetSet) &&
    (floor === null || compareVersions(patch, floor) >= 0)
  console.log(
    targetSet === null
      ? '対象セット: 判定不可（tft_set_number を持つレコードなし）。パッチのみで絞り込む。'
      : `対象セット（tft_set_number 最頻値）: ${targetSet}（${setCounts.get(targetSet)} レコード） ` +
          `保持下限パッチ: ${floor ?? '-'}（直近 ${config.patchesToKeep} パッチ）`,
  )

  // 4. パッチ分布とビュー選定（既定 = ヒステリシス: ユニークマッチ数 >= threshold の最新パッチ）。
  const matchCountByPatch = new Map<string, number>()
  const droppedByFloor: string[] = []
  for (const [key, ms] of matchSets) {
    const [setKey, patch] = key.split('|')
    if (!inSetKeys.has(setKey)) continue
    if (floor !== null && compareVersions(patch, floor) < 0) {
      droppedByFloor.push(`${patch}=${ms.size}`)
      continue
    }
    // 同じパッチが s 有り/無しで分かれている場合は合算する（ID は重複しない前提）。
    matchCountByPatch.set(patch, (matchCountByPatch.get(patch) ?? 0) + ms.size)
  }
  const patchEntries = [...matchCountByPatch.entries()].sort((a, b) => compareVersions(b[0], a[0]))
  console.log(`パッチ分布（ヒステリシス閾値=${config.patchSwitchThreshold} ユニークマッチ）:`)
  for (const [v, matches] of patchEntries) {
    const meets = matches >= config.patchSwitchThreshold ? '達' : '未達'
    console.log(`  ${v}: ユニークマッチ=${matches} (${meets})`)
  }
  if (droppedByFloor.length) console.log(`  保持窓外（除外）: ${droppedByFloor.join(', ')}`)
  const { defaultKey, views } = planPatchViews(matchCountByPatch, config.patchSwitchThreshold)
  if (defaultKey === null) {
    console.error('対象パッチを選定できません（保持窓内のレコードが空）。')
    process.exit(1)
  }
  console.log(`既定パッチ（ヒステリシス選定）: ${defaultKey} / 出力ビュー: ${views.map((v) => v.key).join(', ')}`)

  // 5. 静的データ（セット共通なので、対象セットのトレイト名集合から1回だけ解決）
  const recordTraitNames = new Set<string>()
  for (const k of inSetKeys) for (const t of traitNamesBySet.get(k) ?? []) recordTraitNames.add(t)
  const staticData: StaticData = await getStaticData(recordTraitNames)
  const resolvedTraits = [...recordTraitNames].filter((t) => staticData.traits.has(t)).length
  const coverage = recordTraitNames.size === 0 ? 100 : (resolvedTraits / recordTraitNames.size) * 100
  console.log(
    `選定セット: ${staticData.setNumber}, トレイトカバレッジ: ${coverage.toFixed(1)}% ` +
      `(${recordTraitNames.size} 種中 ${resolvedTraits} 解決)`,
  )

  // 6. パス B（盤面カウント）: 構成キー → パッチ別件数。
  // 最終的に n < MIN_OUTPUT_N で落ちる盤面（大半）のアキュムレータをパス C で作らないための事前カウント。
  t0 = Date.now()
  const patchIdx = new Map<string, number>()
  for (const [p] of patchEntries) patchIdx.set(p, patchIdx.size)
  const boardCounts = new Map<string, number[]>()
  let inScopeRecords = 0
  await forEachRecord(routes.values(), (rec) => {
    const patch = resolvePatch(rec.v, rec.ts, schedule)
    if (!inScope(rec, patch)) return
    inScopeRecords++
    const cls = classifyRecord(rec, staticData)
    if (cls.kind !== 'ok') return
    const pi = patchIdx.get(patch)
    if (pi === undefined) return
    let c = boardCounts.get(cls.boardKey)
    if (!c) {
      c = new Array<number>(patchIdx.size).fill(0)
      boardCounts.set(cls.boardKey, c)
    }
    c[pi]++
  })
  console.log(
    `パス B（盤面カウント）: 対象 ${inScopeRecords} レコード / 盤面 ${boardCounts.size} ${secSince(t0)} heap=${heapMB()}`,
  )

  // 7. ビューごとの builder。boardFilter でそのビュー内の n >= MIN_OUTPUT_N の盤面だけ accumulate する。
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

  const buildersByPatch = new Map<string, StatsBuilder[]>()
  const viewBuilders: { key: string; file: string; builder: StatsBuilder }[] = []
  for (const view of views) {
    const idxs = view.patches.map((p) => patchIdx.get(p)!).filter((i) => i !== undefined)
    const builder = createStatsBuilder(staticData, {
      targetPatch: view.key,
      tftPatch: viewLabel(view.patches),
      generatedAt,
      maxComps: config.maxCompsPerView,
      boardFilter: (key) => {
        const c = boardCounts.get(key)
        if (!c) return false
        let n = 0
        for (const i of idxs) n += c[i]
        return n >= MIN_OUTPUT_N
      },
    })
    viewBuilders.push({ key: view.key, file: viewFileName(view.key, defaultKey), builder })
    for (const p of view.patches) {
      const list = buildersByPatch.get(p) ?? []
      list.push(builder)
      buildersByPatch.set(p, list)
    }
  }

  // 8. パス C（集計）: 対象レコードを、そのパッチを含む全ビューの builder へ。
  t0 = Date.now()
  await forEachRecord(routes.values(), (rec, route) => {
    const patch = resolvePatch(rec.v, rec.ts, schedule)
    if (!inScope(rec, patch)) return
    const bs = buildersByPatch.get(patch)
    if (!bs) return
    for (const b of bs) b.add(rec, route)
  })
  console.log(`パス C（集計）: ${secSince(t0)} heap=${heapMB()}`)

  const outputs: { file: string; out: WireStatsFile }[] = []
  const unresolvedTraitNames = new Set<string>()
  const unresolvedUnitNames = new Set<string>()
  const unresolvedEmblemNames = new Set<string>()
  for (const { key, file, builder } of viewBuilders) {
    const { out: built, diag } = builder.finish()
    // comps を最後のキーに保つ。書き出し（serializeStatsFile）と同じキー順にしておかないと、
    // 読み戻した前回分との比較（isUnchanged）が毎回食い違って無駄に書き直す。
    const { comps, ...head } = built
    const out: WireStatsFile = { ...head, patches: index, comps }
    outputs.push({ file, out })
    console.log(
      `[${key}] 盤面グループ(accumulate): ${diag.boardGroupCount}` +
        `（盤面なし除外 ${diag.noBoard}, 未解決トレイト除外 ${diag.excludedUnresolvedTrait}, ` +
        `紋章シグネチャなし ${diag.noSigBoards}, 総レコード数の上位として追加 ${diag.popularAdded}）` +
        ` comps=${out.comps.length} matches=${out.totals.matches} → ${file}`,
    )
    for (const n of diag.unresolvedTraitNames) unresolvedTraitNames.add(n)
    for (const n of diag.unresolvedUnitNames) unresolvedUnitNames.add(n)
    for (const n of diag.unresolvedEmblemNames) unresolvedEmblemNames.add(n)
  }

  // 9. 書き出し。実質差分のないファイルは触らず、今回のビューに無い旧 stats-*.json は消す。
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const written: string[] = []
  const skipped: string[] = []
  for (const { file, out } of outputs) {
    const path = join(OUT_DIR, file)
    if (isUnchanged(path, out)) {
      skipped.push(file)
      continue
    }
    writeFileSync(path, serializeStatsFile(out))
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

  // 10. ログ
  console.log('--- 集計サマリ ---')
  console.log(`既定パッチ: ${labelOf(defaultKey)}（内部 ${defaultKey}） → ${DEFAULT_FILE}`)
  for (const { file, out } of outputs) {
    const body = serializeStatsFile(out)
    const sizeKB = (Buffer.byteLength(body) / 1024).toFixed(1)
    const gzKB = (gzipSync(body).length / 1024).toFixed(1)
    const totalSigs = out.comps.reduce((s, c) => s + c.g.length, 0)
    const capped = config.maxCompsPerView > 0 && out.comps.length >= config.maxCompsPerView ? '（上限で切詰）' : ''
    console.log(
      `  ${file}: patch=${out.tftPatch} comps=${out.comps.length}${capped} sig=${totalSigs} ` +
        `matches=${out.totals.matches} participants=${out.totals.participants} (${sizeKB} KB, gzip ${gzKB} KB)`,
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
  if (scan.parseFailures > 0) warnLines.push(`[parse失敗] ${scan.parseFailures} 行`)
  if (duplicateMatchGroups > 0) {
    warnLines.push(`[重複マッチ] 同じマッチIDが非連続に ${duplicateMatchGroups} 回出現（レコードが二重に追記されている可能性）`)
  }
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
