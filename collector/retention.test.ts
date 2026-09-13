import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shardFileName, parseShardFile, compareShards, planRetention, type ShardMeta } from './retention.ts'
import { retentionFloor } from './patches.ts'

const SCHEDULE = [
  { patch: '18.1', since: '2026-08-26T00:00:00Z' },
  { patch: '18.2', since: '2026-09-10T00:00:00Z' },
  { patch: '18.3', since: '2026-09-24T00:00:00Z' },
]
const T = (iso: string) => Math.floor(Date.parse(iso) / 1000)
const NOW = Date.parse('2026-09-13T00:00:00Z') // 18.2 の途中

// ---- retentionFloor ----

test('retentionFloor: since<=now のエントリのうち末尾 N 件の先頭（未来の配信は無視）', () => {
  assert.equal(retentionFloor(SCHEDULE, 18, 2, NOW), '18.1')
  assert.equal(retentionFloor(SCHEDULE, 18, 1, NOW), '18.2')
  // 18.3 配信後は 18.2 が下限。
  assert.equal(retentionFloor(SCHEDULE, 18, 2, Date.parse('2026-09-25T00:00:00Z')), '18.2')
})

test('retentionFloor: 他セット無視・該当なしは null・N が多すぎれば最古', () => {
  assert.equal(retentionFloor(SCHEDULE, 19, 2, NOW), null)
  assert.equal(retentionFloor([], 18, 2, NOW), null)
  assert.equal(retentionFloor(SCHEDULE, 18, 10, NOW), '18.1')
})

test('retentionFloor: 配列順に依存しない', () => {
  assert.equal(retentionFloor([...SCHEDULE].reverse(), 18, 2, NOW), '18.1')
})

// ---- ファイル名 ----

test('shardFileName / parseShardFile: 往復し、規則外は null', () => {
  const name = shardFileName(7, 18, 100, 200)
  assert.equal(name, '000007_s18_100-200.ndjson.gz')
  assert.deepEqual(parseShardFile(name, 123), { seq: 7, file: name, set: 18, minTs: 100, maxTs: 200, gzBytes: 123 })
  assert.deepEqual(parseShardFile(shardFileName(1, null, 5, 6))?.set, null)
  assert.equal(parseShardFile('manifest.json'), null)
  assert.equal(parseShardFile('foo.ndjson.gz'), null)
  assert.equal(parseShardFile('000001.ndjson.gz'), null)
})

test('compareShards: seq 数値順（000010 は 000002 の後）', () => {
  const a = parseShardFile(shardFileName(10, 18, 0, 0))!
  const b = parseShardFile(shardFileName(2, 18, 0, 0))!
  assert.ok(compareShards(b, a) < 0)
  assert.deepEqual([a, b].sort(compareShards).map((s) => s.seq), [2, 10])
})

// ---- planRetention ----

function shard(seq: number, set: number | null, maxIso: string, gzBytes: number, minIso = '2026-08-26T00:00:00Z'): ShardMeta {
  const minTs = T(minIso)
  const maxTs = T(maxIso)
  return parseShardFile(shardFileName(seq, set, minTs, maxTs), gzBytes)!
}
const OPTS = { schedule: SCHEDULE, patchesToKeep: 2, maxGzBytes: 0, nowMs: NOW }

test('planRetention: 旧セット・セット不明は old-set', () => {
  const plan = planRetention(
    [shard(1, 17, '2026-08-20T00:00:00Z', 1), shard(2, null, '2026-09-01T00:00:00Z', 1), shard(3, 18, '2026-09-01T00:00:00Z', 1)],
    OPTS,
  )
  assert.equal(plan.currentSet, 18)
  assert.deepEqual(plan.drop.map((d) => [d.shard.seq, d.reason]), [[1, 'old-set'], [2, 'old-set']])
  assert.deepEqual(plan.keep.map((s) => s.seq), [3])
})

test('planRetention: 最新レコードが floor より古いシャードは old-patch、またぎは keep', () => {
  const later = { ...OPTS, nowMs: Date.parse('2026-09-25T00:00:00Z') } // floor=18.2
  const plan = planRetention(
    [
      shard(1, 18, '2026-09-05T00:00:00Z', 1), // 全部 18.1 → drop
      shard(2, 18, '2026-09-11T00:00:00Z', 1, '2026-09-08T00:00:00Z'), // 18.1〜18.2 またぎ → keep
      shard(3, 18, '2026-09-20T00:00:00Z', 1),
    ],
    later,
  )
  assert.equal(plan.floor, '18.2')
  assert.deepEqual(plan.drop.map((d) => [d.shard.seq, d.reason]), [[1, 'old-patch']])
  assert.deepEqual(plan.keep.map((s) => s.seq), [2, 3])
})

test('planRetention: floor が無ければパッチ規則は適用しない', () => {
  const plan = planRetention([shard(1, 18, '2026-08-01T00:00:00Z', 1)], { ...OPTS, schedule: [] })
  assert.equal(plan.floor, null)
  assert.deepEqual(plan.drop, [])
})

test('planRetention: byte-cap は古い seq から予算内に収まるまで落とす', () => {
  const plan = planRetention(
    [shard(1, 18, '2026-09-01T00:00:00Z', 30), shard(2, 18, '2026-09-05T00:00:00Z', 30), shard(3, 18, '2026-09-12T00:00:00Z', 30)],
    { ...OPTS, maxGzBytes: 70 },
  )
  assert.deepEqual(plan.drop.map((d) => [d.shard.seq, d.reason]), [[1, 'byte-cap']])
  assert.deepEqual(plan.keep.map((s) => s.seq), [2, 3])
})

test('planRetention: 現パッチが増えると前パッチのシャードが押し出される（予算が主規則）', () => {
  // 18.1 のシャード2つ + 18.2 のシャード3つ、予算は3シャード分。
  const shards = [
    shard(1, 18, '2026-09-01T00:00:00Z', 10),
    shard(2, 18, '2026-09-08T00:00:00Z', 10),
    shard(3, 18, '2026-09-10T12:00:00Z', 10),
    shard(4, 18, '2026-09-11T12:00:00Z', 10),
    shard(5, 18, '2026-09-12T12:00:00Z', 10),
  ]
  const plan = planRetention(shards, { ...OPTS, maxGzBytes: 30 })
  assert.equal(plan.floor, '18.1') // パッチ規則ではまだ何も落ちない
  assert.deepEqual(plan.drop.map((d) => [d.shard.seq, d.reason]), [[1, 'byte-cap'], [2, 'byte-cap']])
  assert.deepEqual(plan.keep.map((s) => s.seq), [3, 4, 5])
})

test('planRetention: 空入力', () => {
  assert.deepEqual(planRetention([], OPTS), { keep: [], drop: [], currentSet: null, floor: null })
})
