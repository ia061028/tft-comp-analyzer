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
/** prune の1行分の解析結果。 */
interface PruneLine {
  line: string
  /** JSON として読めなかった行（常に保持する安全側の扱い）。 */
  unparsable: boolean
  s?: number
  m?: string
  ts: number
}

/**
 * NDJSON 内容をローリング窓ポリシーでフィルタする純関数。
 *
 * 1. **旧セットの切り捨て**: `s`(tft_set_number) を持つ行が1件でもあれば、最大の `s` 以外を落とす。
 *    `s` を持たない旧形式レコードもここで落ちる。`s` を持つ行が皆無なら何もしない（全消し防止）。
 * 2. **窓あふれの切り捨て**: 残った行が maxRecords を超える場合、マッチ単位（`m`）で新しい順に
 *    保持し、はみ出したマッチを丸ごと落とす。マッチを分断しないのは、1マッチ8参加者が
 *    揃っていないと totals.matches が実態とずれるため。
 *
 * パース不能行は常に保持し、窓の予算からも除外する（安全側）。
 * 出力は元の行順を維持する（append-only に近い形を保ち、git のデルタ圧縮を効かせるため）。
 */
export function filterNdjsonForWindow(
  content: string,
  maxRecords: number,
): { out: string; kept: number; droppedOldSet: number; droppedOverflow: number; targetSet: number | null } {
  const parsed: PruneLine[] = []
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    try {
      const rec = JSON.parse(line) as { s?: unknown; m?: unknown; ts?: unknown }
      parsed.push({
        line,
        unparsable: false,
        s: typeof rec.s === 'number' ? rec.s : undefined,
        m: typeof rec.m === 'string' ? rec.m : undefined,
        ts: typeof rec.ts === 'number' ? rec.ts : 0,
      })
    } catch {
      parsed.push({ line, unparsable: true, ts: 0 })
    }
  }

  // 1. 旧セットの切り捨て。
  let targetSet: number | null = null
  for (const p of parsed) {
    if (p.s !== undefined && (targetSet === null || p.s > targetSet)) targetSet = p.s
  }
  let droppedOldSet = 0
  const afterSet = parsed.filter((p) => {
    if (p.unparsable) return true
    if (targetSet === null) return true
    if (p.s === targetSet) return true
    droppedOldSet++
    return false
  })

  // 2. 窓あふれの切り捨て（マッチ単位・新しい順）。
  let droppedOverflow = 0
  let survivors = afterSet
  const budgeted = afterSet.filter((p) => !p.unparsable)
  if (maxRecords > 0 && budgeted.length > maxRecords) {
    // マッチごとの代表 ts（最大値）と行数を集計。
    const byMatch = new Map<string, { ts: number; n: number }>()
    for (const p of budgeted) {
      const key = p.m ?? ''
      const cur = byMatch.get(key)
      if (cur === undefined) byMatch.set(key, { ts: p.ts, n: 1 })
      else {
        cur.n++
        if (p.ts > cur.ts) cur.ts = p.ts
      }
    }
    // 新しい順。同 ts はマッチID昇順で決定的に。
    const order = [...byMatch.entries()].sort((a, b) =>
      b[1].ts !== a[1].ts ? b[1].ts - a[1].ts : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    const keepMatches = new Set<string>()
    let budget = maxRecords
    for (const [m, info] of order) {
      if (info.n > budget) break
      keepMatches.add(m)
      budget -= info.n
    }
    survivors = afterSet.filter((p) => {
      if (p.unparsable) return true
      if (keepMatches.has(p.m ?? '')) return true
      droppedOverflow++
      return false
    })
  }

  const keptLines = survivors.map((p) => p.line)
  const out = keptLines.length > 0 ? keptLines.join('\n') + '\n' : ''
  return { out, kept: keptLines.length, droppedOldSet, droppedOverflow, targetSet }
}

/**
 * records/{route}.ndjson をローリング窓ポリシーで書き換える。
 * 1行も落ちなければファイルに触らない（append-only を維持し git delta を保つ）。
 * ファイルが存在しなければ何もしない。
 */
export function pruneRecords(
  route: string,
  maxRecords: number,
): { kept: number; droppedOldSet: number; droppedOverflow: number; targetSet: number | null } {
  const path = recordsPath(route)
  if (!existsSync(path)) return { kept: 0, droppedOldSet: 0, droppedOverflow: 0, targetSet: null }
  const content = readFileSync(path, 'utf8')
  const { out, kept, droppedOldSet, droppedOverflow, targetSet } = filterNdjsonForWindow(
    content,
    maxRecords,
  )
  if (droppedOldSet + droppedOverflow > 0) writeFileSync(path, out)
  return { kept, droppedOldSet, droppedOverflow, targetSet }
}
