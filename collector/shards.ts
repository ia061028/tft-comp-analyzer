// records/ のシャード I/O。
//
// レイアウト:
//   records/{route}.ndjson                               アクティブシャード（生 NDJSON、追記専用）
//   records/{route}/{seq}_s{set}_{min}-{max}.ndjson.gz   封印シャード（不変。retention.ts の命名規則）
//
// 全関数が recordsDir を引数に取るので、テストは一時ディレクトリで実行できる。
// レコードは常にストリームで読む（全件をメモリに展開しない）。

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { ParticipantRecord } from '../shared/types.ts'
import {
  compareShards,
  parseShardFile,
  planRetention,
  shardFileName,
  type RetentionOptions,
  type RetentionPlan,
  type ShardMeta,
} from './retention.ts'

export interface RouteShards {
  route: string
  /** アクティブシャードのパス（無ければ null）。 */
  active: string | null
  /** 封印シャードのディレクトリ（存在しないこともある）。 */
  sealedDir: string
  /** 封印シャード（seq 昇順）。 */
  sealed: ShardMeta[]
}

export function activePath(recordsDir: string, route: string): string {
  return join(recordsDir, `${route}.ndjson`)
}

export function shardDir(recordsDir: string, route: string): string {
  return join(recordsDir, route)
}

/** 1ルートのシャード一覧（封印は seq 昇順、gzBytes は stat から）。 */
export function listShards(recordsDir: string, route: string): RouteShards {
  const active = activePath(recordsDir, route)
  const dir = shardDir(recordsDir, route)
  const sealed: ShardMeta[] = []
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const meta = parseShardFile(f, 0)
      if (!meta) continue
      meta.gzBytes = statSync(join(dir, f)).size
      sealed.push(meta)
    }
    sealed.sort(compareShards)
  }
  return { route, active: existsSync(active) ? active : null, sealedDir: dir, sealed }
}

/**
 * records/ 配下からルートごとのシャード一覧を作る（ルート名昇順）。
 * `{route}.ndjson` と `{route}/` のうち knownRoutes に含まれるものだけを拾い、
 * それ以外は warn して無視する（偽ルートが totals.byRoute に混ざるのを防ぐ）。
 */
export function listRouteShards(
  recordsDir: string,
  knownRoutes: ReadonlySet<string>,
  warn: (msg: string) => void = () => {},
): Map<string, RouteShards> {
  const out = new Map<string, RouteShards>()
  if (!existsSync(recordsDir)) return out
  const routes = new Set<string>()
  for (const entry of readdirSync(recordsDir, { withFileTypes: true })) {
    let route: string | null = null
    if (entry.isFile() && entry.name.endsWith('.ndjson')) route = entry.name.slice(0, -'.ndjson'.length)
    else if (entry.isDirectory()) route = entry.name
    if (route === null) {
      warn(`records/${entry.name}: 無視`)
      continue
    }
    if (!knownRoutes.has(route)) {
      warn(`records/${entry.name}: 未知のルート名のため無視`)
      continue
    }
    routes.add(route)
  }
  for (const route of [...routes].sort()) {
    const rs = listShards(recordsDir, route)
    if (existsSync(rs.sealedDir)) {
      for (const f of readdirSync(rs.sealedDir)) {
        if (!parseShardFile(f)) warn(`records/${route}/${f}: 封印シャードの命名規則に合わないため無視`)
      }
    }
    out.set(route, rs)
  }
  return out
}

/** NDJSON（必要なら gunzip）を1行ずつ返す。 */
export async function* readLines(path: string, gz: boolean): AsyncGenerator<string> {
  const raw = createReadStream(path)
  const input = gz ? raw.pipe(createGunzip()) : raw
  const rl = createInterface({ input, crlfDelay: Infinity })
  for await (const line of rl) yield line
}

export interface StreamStats {
  records: number
  parseFailures: number
  files: number
}

/** 1ファイルのレコードを1件ずつ fn へ渡す。パース不能行は数えて読み飛ばす。 */
async function feedFile(
  path: string,
  gz: boolean,
  route: string,
  fn: (rec: ParticipantRecord, route: string) => void,
  stats: StreamStats,
): Promise<void> {
  stats.files++
  for await (const line of readLines(path, gz)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: ParticipantRecord
    try {
      rec = JSON.parse(trimmed) as ParticipantRecord
    } catch {
      stats.parseFailures++
      continue
    }
    stats.records++
    fn(rec, route)
  }
}

/**
 * 全ルートの全レコードを、ルートごとに封印シャード（seq 順）→ アクティブの順で1件ずつ fn へ渡す。
 * fn は同期関数。
 */
export async function forEachRecord(
  routes: Iterable<RouteShards>,
  fn: (rec: ParticipantRecord, route: string) => void,
): Promise<StreamStats> {
  const stats: StreamStats = { records: 0, parseFailures: 0, files: 0 }
  for (const rs of routes) {
    for (const s of rs.sealed) await feedFile(join(rs.sealedDir, s.file), true, rs.route, fn, stats)
    if (rs.active) await feedFile(rs.active, false, rs.route, fn, stats)
  }
  return stats
}

export interface ScanResult {
  minTs: number
  maxTs: number
  /** 最大の tft_set_number（s を持つレコードが無ければ null）。 */
  set: number | null
  records: number
  matches: number
  parseFailures: number
}

/** NDJSON を走査して封印に必要な統計（ts 範囲・セット・件数）を取る。 */
export async function scanNdjson(path: string, gz: boolean): Promise<ScanResult> {
  let minTs = Infinity
  let maxTs = -Infinity
  let set: number | null = null
  const matches = new Set<string>()
  const stats: StreamStats = { records: 0, parseFailures: 0, files: 0 }
  await feedFile(
    path,
    gz,
    '',
    (rec) => {
      if (typeof rec.ts === 'number') {
        if (rec.ts < minTs) minTs = rec.ts
        if (rec.ts > maxTs) maxTs = rec.ts
      }
      if (typeof rec.s === 'number' && (set === null || rec.s > set)) set = rec.s
      if (typeof rec.m === 'string') matches.add(rec.m)
    },
    stats,
  )
  if (stats.records === 0) {
    minTs = 0
    maxTs = 0
  }
  return { minTs, maxTs, set, records: stats.records, matches: matches.size, parseFailures: stats.parseFailures }
}

export interface SealResult {
  meta: ShardMeta
  rawBytes: number
  records: number
  matches: number
}

/**
 * アクティブシャードが thresholdBytes を超えていれば丸ごと gzip して封印する。
 * 手順: 走査（ts 範囲・セット）→ gzip を一時ファイルへ → rename → アクティブを削除。
 * 超えていない／存在しない場合は null。
 */
export async function sealActiveShard(
  recordsDir: string,
  route: string,
  thresholdBytes: number,
): Promise<SealResult | null> {
  const active = activePath(recordsDir, route)
  if (!existsSync(active)) return null
  const rawBytes = statSync(active).size
  if (rawBytes <= thresholdBytes) return null

  const scan = await scanNdjson(active, false)
  if (scan.records === 0) return null // 中身が無いものは封印しない（空シャードを作らない）

  const dir = shardDir(recordsDir, route)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const existing = listShards(recordsDir, route).sealed
  const seq = (existing.length ? existing[existing.length - 1].seq : 0) + 1
  const file = shardFileName(seq, scan.set, scan.minTs, scan.maxTs)
  const tmp = join(dir, `.sealing-${seq}.tmp`)
  await pipeline(createReadStream(active), createGzip({ level: 6 }), createWriteStream(tmp))
  renameSync(tmp, join(dir, file))
  unlinkSync(active)

  const meta = parseShardFile(file, statSync(join(dir, file)).size)!
  return { meta, rawBytes, records: scan.records, matches: scan.matches }
}

/** 保持計画の drop を削除する。 */
export function applyRetention(recordsDir: string, route: string, plan: RetentionPlan): void {
  const dir = shardDir(recordsDir, route)
  for (const { shard } of plan.drop) {
    const p = join(dir, shard.file)
    if (existsSync(p)) unlinkSync(p)
  }
}

export interface SealAndPruneOptions extends RetentionOptions {
  sealThresholdBytes: number
}

/** 封印 → 保持計画 → 削除、をまとめて行う（collect の末尾と data:seal から呼ぶ）。 */
export async function sealAndPrune(
  recordsDir: string,
  route: string,
  opts: SealAndPruneOptions,
): Promise<{ sealed: SealResult | null; plan: RetentionPlan; after: RouteShards }> {
  const sealed = await sealActiveShard(recordsDir, route, opts.sealThresholdBytes)
  const before = listShards(recordsDir, route)
  const plan = planRetention(before.sealed, opts)
  applyRetention(recordsDir, route, plan)
  return { sealed, plan, after: listShards(recordsDir, route) }
}
