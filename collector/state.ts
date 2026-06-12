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

/**
 * NDJSON 内容を `v`（パッチ）が keep に含まれる行だけ残してフィルタする純関数。
 * - パース不能行は保持（安全側）。
 * - `v` が無い／keep 外の行は dropped としてカウント。
 * 末尾の改行有無は元コンテンツに合わせる（dropped が 0 ならそもそも書き換えない方針）。
 */
export function filterNdjsonByPatch(
  content: string,
  keep: Set<string>,
): { out: string; kept: number; dropped: number } {
  let kept = 0
  let dropped = 0
  const keptLines: string[] = []
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    let v: unknown
    try {
      v = (JSON.parse(line) as { v?: unknown }).v
    } catch {
      // パース不能行は保持（安全側）。
      keptLines.push(line)
      kept++
      continue
    }
    if (typeof v === 'string' && keep.has(v)) {
      keptLines.push(line)
      kept++
    } else {
      dropped++
    }
  }
  const out = keptLines.length > 0 ? keptLines.join('\n') + '\n' : ''
  return { out, kept, dropped }
}

/**
 * records/{route}.ndjson を読み、`v` が keep に含まれる行だけ残して書き換える。
 * dropped が 0 ならファイルに触らない（append-only を維持し git delta を保つ）。
 * ファイルが存在しなければ何もしない。
 */
export function pruneRecords(route: string, keep: Set<string>): { kept: number; dropped: number } {
  const path = recordsPath(route)
  if (!existsSync(path)) return { kept: 0, dropped: 0 }
  const content = readFileSync(path, 'utf8')
  const { out, kept, dropped } = filterNdjsonByPatch(content, keep)
  if (dropped > 0) writeFileSync(path, out)
  return { kept, dropped }
}
