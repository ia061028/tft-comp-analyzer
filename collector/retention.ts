// 封印シャードの命名と保持判定（純関数。fs 非依存でテスト可能に保つ）。
//
// シャードのファイル名は自己記述: `{seq 6桁}_s{set}_{minTs}-{maxTs}.ndjson.gz`（set 不明は sX）。
// 保持判定に必要な情報（セット・最新 ts）はファイル名から、サイズは stat から取れるので
// manifest のような索引ファイルは持たない（索引と実体のズレを気にしなくてよい）。

import { compareVersions, resolvePatch, retentionFloor, type PatchScheduleEntry } from './patches.ts'

export interface ShardMeta {
  /** 連番（1 始まり）。時系列順＝ソート順。 */
  seq: number
  /** ファイル名（ディレクトリを含まない）。 */
  file: string
  /** シャード内の game_datetime の最小/最大（epoch 秒）。 */
  minTs: number
  maxTs: number
  /** シャード内の最大 tft_set_number。s を持つレコードが無ければ null。 */
  set: number | null
  /** gzip 後のバイト数（保持予算の単位）。 */
  gzBytes: number
}

export const SHARD_FILE_RE = /^(\d{6})_s(\d+|X)_(\d+)-(\d+)\.ndjson\.gz$/

export function shardFileName(seq: number, set: number | null, minTs: number, maxTs: number): string {
  return `${String(seq).padStart(6, '0')}_s${set ?? 'X'}_${minTs}-${maxTs}.ndjson.gz`
}

/** ファイル名を解析する。封印シャードの命名規則に合わなければ null（無関係なファイルは無視）。 */
export function parseShardFile(file: string, gzBytes = 0): ShardMeta | null {
  const m = file.match(SHARD_FILE_RE)
  if (!m) return null
  return {
    seq: Number(m[1]),
    file,
    set: m[2] === 'X' ? null : Number(m[2]),
    minTs: Number(m[3]),
    maxTs: Number(m[4]),
    gzBytes,
  }
}

/** seq 昇順（同 seq はファイル名で決定的に）。 */
export function compareShards(a: ShardMeta, b: ShardMeta): number {
  return a.seq - b.seq || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
}

export type DropReason = 'old-set' | 'old-patch' | 'byte-cap'

export interface RetentionPlan {
  keep: ShardMeta[]
  drop: { shard: ShardMeta; reason: DropReason }[]
  /** シャード群から判定した現行セット（set 不明のみなら null）。 */
  currentSet: number | null
  /** 保持下限パッチ（規則が適用できなければ null）。 */
  floor: string | null
}

export interface RetentionOptions {
  schedule: PatchScheduleEntry[]
  patchesToKeep: number
  /** 封印シャードの gz 合計の上限（0 以下で無制限）。 */
  maxGzBytes: number
  nowMs: number
}

/**
 * 封印シャードの保持計画。
 * 1. 現行セット（最大の set）以外は落とす（set 不明も、現行セットが判明していれば落とす）。
 * 2. 最新レコード（maxTs）のパッチが floor より古いシャードを落とす。境界をまたぐシャードは
 *    最新レコードが窓外になるまで残す（その間の旧パッチレコードは aggregate 側で除外する）。
 * 3. 残りの gz 合計が maxGzBytes を超えていれば、古い seq から予算内に収まるまで落とす。
 *    定常時に実際に効くのはこの規則で、現パッチが増えるほど前パッチのシャードが押し出される。
 * 出力の順序は seq 昇順。
 */
export function planRetention(shards: ShardMeta[], opts: RetentionOptions): RetentionPlan {
  const sorted = [...shards].sort(compareShards)
  let currentSet: number | null = null
  for (const s of sorted) {
    if (s.set !== null && (currentSet === null || s.set > currentSet)) currentSet = s.set
  }
  const floor = currentSet === null ? null : retentionFloor(opts.schedule, currentSet, opts.patchesToKeep, opts.nowMs)

  const drop: RetentionPlan['drop'] = []
  let keep: ShardMeta[] = []
  for (const s of sorted) {
    if (currentSet !== null && s.set !== currentSet) {
      drop.push({ shard: s, reason: 'old-set' })
      continue
    }
    if (floor !== null && s.set !== null) {
      const newestPatch = resolvePatch(`${s.set}.0`, s.maxTs, opts.schedule)
      if (compareVersions(newestPatch, floor) < 0) {
        drop.push({ shard: s, reason: 'old-patch' })
        continue
      }
    }
    keep.push(s)
  }

  if (opts.maxGzBytes > 0) {
    let total = keep.reduce((sum, s) => sum + s.gzBytes, 0)
    let i = 0
    while (total > opts.maxGzBytes && i < keep.length) {
      drop.push({ shard: keep[i], reason: 'byte-cap' })
      total -= keep[i].gzBytes
      i++
    }
    keep = keep.slice(i)
  }

  drop.sort((a, b) => compareShards(a.shard, b.shard))
  return { keep, drop, currentSet, floor }
}
