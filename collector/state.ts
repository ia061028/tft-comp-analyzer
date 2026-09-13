// data/state/ 配下の NDJSON 状態管理。追記専用でクラッシュ安全に運用する。
// records の封印・保持は shards.ts / retention.ts が担当する。

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ParticipantRecord } from '../shared/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
// collector/ の一つ上がリポジトリルート。
export const STATE_DIR = join(here, '..', 'data', 'state')
export const SEEN_DIR = join(STATE_DIR, 'seen')
export const RECORDS_DIR = join(STATE_DIR, 'records')
const META_PATH = join(STATE_DIR, 'meta.json')
const GITATTRIBUTES_PATH = join(STATE_DIR, '.gitattributes')

export interface RouteMeta {
  /** 前回実行の開始時刻（epoch秒） */
  lastRunStartedAt: number
}

export interface Meta {
  schemaVersion: 1
  routes: Record<string, RouteMeta>
  /**
   * seen を溜め始めた基準時刻（config.collectSinceEpoch の値）。
   * これが設定値と異なれば「セットが替わった」とみなして seen をリセットする。
   */
  collectSince?: number
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

/** 参加者レコードを1行1件のJSONでアクティブシャードへ追記する（追記専用）。 */
export function appendRecords(route: string, records: ParticipantRecord[]): void {
  if (records.length === 0) return
  ensureDirs()
  appendFileSync(recordsPath(route), records.map((r) => JSON.stringify(r) + '\n').join(''))
}

/**
 * seen をリセットすべきか。
 * - meta に collectSince が無い（旧レイアウト）: リセットせず現値を採用するだけ（初回の再取得嵐を避ける）。
 * - 同値: しない。
 * - 異なる: する（セットが替わった＝旧セットの ID は API から取れないので seen に残す意味が無い）。
 */
export function shouldResetSeen(metaValue: number | undefined, configValue: number): boolean {
  if (metaValue === undefined) return false
  return metaValue !== configValue
}

/**
 * config.collectSinceEpoch が変わっていれば seen/*.ndjson を空にする。meta.collectSince を現値に更新する
 * （呼び出し側が saveMeta する）。戻り値はリセットしたか。
 */
export function resetSeenIfSetChanged(meta: Meta, configValue: number): boolean {
  const reset = shouldResetSeen(meta.collectSince, configValue)
  if (reset && existsSync(SEEN_DIR)) {
    for (const f of readdirSync(SEEN_DIR)) {
      if (f.endsWith('.ndjson')) writeFileSync(join(SEEN_DIR, f), '')
    }
  }
  meta.collectSince = configValue
  return reset
}

/** data ブランチ用 .gitattributes の内容。gz を binary にしないと Windows で CRLF 変換されて壊れる。 */
export const DATA_GITATTRIBUTES = '*.ndjson text eol=lf\n*.json text eol=lf\n*.gz binary\n'

/**
 * data/state/.gitattributes を（内容が違う時だけ）書く。CI の push ステップは `git add -A` なので
 * 次回の成功ランで data ブランチに乗る。戻り値は書き換えたか。
 */
export function ensureDataGitattributes(path: string = GITATTRIBUTES_PATH): boolean {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (current === DATA_GITATTRIBUTES) return false
  ensureDirs()
  writeFileSync(path, DATA_GITATTRIBUTES)
  return true
}
