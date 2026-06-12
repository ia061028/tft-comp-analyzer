// data/state/ 配下の NDJSON 状態管理。追記専用でクラッシュ安全に運用する。

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ParticipantRecord } from '../shared/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
// collector/ の一つ上がリポジトリルート。
const STATE_DIR = join(here, '..', 'data', 'state')
const SEEN_DIR = join(STATE_DIR, 'seen')
const RECORDS_DIR = join(STATE_DIR, 'records')
const META_PATH = join(STATE_DIR, 'meta.json')

export interface RouteMeta {
  /** 前回実行の開始時刻（epoch秒） */
  lastRunStartedAt: number
}

export interface Meta {
  schemaVersion: 1
  routes: Record<string, RouteMeta>
}

function ensureDirs(): void {
  for (const dir of [STATE_DIR, SEEN_DIR, RECORDS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

export function loadMeta(): Meta {
  if (!existsSync(META_PATH)) {
    return { schemaVersion: 1, routes: {} }
  }
  const raw = readFileSync(META_PATH, 'utf8')
  const parsed = JSON.parse(raw) as Meta
  if (!parsed.routes) parsed.routes = {}
  return parsed
}

export function saveMeta(meta: Meta): void {
  ensureDirs()
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n')
}

function seenPath(route: string): string {
  return join(SEEN_DIR, `${route}.ndjson`)
}

function recordsPath(route: string): string {
  return join(RECORDS_DIR, `${route}.ndjson`)
}

/** seen NDJSON（1行1マッチID）を読み込む。ファイル無しは空 Set。 */
export function loadSeen(route: string): Set<string> {
  const path = seenPath(route)
  const seen = new Set<string>()
  if (!existsSync(path)) return seen
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const id = line.trim()
    if (id) seen.add(id)
  }
  return seen
}

/** 処理済みマッチIDを追記する（追記専用）。 */
export function appendSeen(route: string, ids: string[]): void {
  if (ids.length === 0) return
  ensureDirs()
  appendFileSync(seenPath(route), ids.map((id) => id + '\n').join(''))
}

/** 参加者レコードを1行1件のJSONで追記する（追記専用）。 */
export function appendRecords(route: string, records: ParticipantRecord[]): void {
  if (records.length === 0) return
  ensureDirs()
  appendFileSync(recordsPath(route), records.map((r) => JSON.stringify(r) + '\n').join(''))
}
