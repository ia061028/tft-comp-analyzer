import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listRouteShards, forEachRecord, scanNdjson, sealActiveShard, sealAndPrune } from './shards.ts'
import { shardFileName } from './retention.ts'
import type { ParticipantRecord } from '../shared/types.ts'
import { gzipSync } from 'node:zlib'

const KNOWN = new Set(['asia', 'sea'])

function rec(m: string, ts: number, s = 18): string {
  const r: ParticipantRecord = { m, v: '18.0', s, p: 1, t: {}, e: [], u: ['X'], lv: 8, ts }
  return JSON.stringify(r)
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'tft-shards-'))
}

test('listRouteShards: 既知ルートの active と封印シャードだけ拾い、他は警告して無視', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'asia.ndjson'), rec('A1', 10) + '\n')
  mkdirSync(join(dir, 'asia'))
  writeFileSync(join(dir, 'asia', shardFileName(1, 18, 1, 2)), gzipSync(rec('A0', 1) + '\n'))
  writeFileSync(join(dir, 'asia', 'notes.txt'), 'x')
  writeFileSync(join(dir, 'bogus.ndjson'), rec('B1', 10) + '\n')
  mkdirSync(join(dir, 'sea'))
  const warnings: string[] = []
  const routes = listRouteShards(dir, KNOWN, (m) => warnings.push(m))
  assert.deepEqual([...routes.keys()], ['asia', 'sea'])
  const asia = routes.get('asia')!
  assert.equal(asia.active, join(dir, 'asia.ndjson'))
  assert.deepEqual(asia.sealed.map((s) => s.seq), [1])
  assert.ok(asia.sealed[0].gzBytes > 0)
  assert.equal(routes.get('sea')!.active, null)
  assert.ok(warnings.some((w) => w.includes('bogus.ndjson')))
  assert.ok(warnings.some((w) => w.includes('notes.txt')))
})

test('forEachRecord: 封印（seq 順）→ active の順で全件、parse 失敗は数える', async () => {
  const dir = tmp()
  mkdirSync(join(dir, 'asia'))
  writeFileSync(join(dir, 'asia', shardFileName(2, 18, 3, 3)), gzipSync(rec('S2', 3) + '\n'))
  writeFileSync(join(dir, 'asia', shardFileName(1, 18, 1, 2)), gzipSync(rec('S1a', 1) + '\n' + rec('S1b', 2) + '\n'))
  writeFileSync(join(dir, 'asia.ndjson'), rec('A1', 10) + '\n{broken\n' + rec('A2', 11)) // 末尾改行なし
  const seen: string[] = []
  const stats = await forEachRecord(listRouteShards(dir, KNOWN).values(), (r, route) => seen.push(`${route}:${r.m}`))
  assert.deepEqual(seen, ['asia:S1a', 'asia:S1b', 'asia:S2', 'asia:A1', 'asia:A2'])
  assert.equal(stats.records, 5)
  assert.equal(stats.parseFailures, 1)
  assert.equal(stats.files, 3)
})

test('scanNdjson: ts 範囲・最大セット・件数', async () => {
  const dir = tmp()
  const p = join(dir, 'x.ndjson')
  writeFileSync(p, rec('M1', 50, 17) + '\n' + rec('M1', 70, 18) + '\n' + rec('M2', 60, 18) + '\n')
  const r = await scanNdjson(p, false)
  assert.equal(r.minTs, 50)
  assert.equal(r.maxTs, 70)
  assert.equal(r.set, 18)
  assert.equal(r.records, 3)
  assert.equal(r.matches, 2)
})

test('sealActiveShard: 閾値以下は何もしない、超えたら gz が往復一致し active は消える', async () => {
  const dir = tmp()
  const content = rec('M1', 100) + '\n' + rec('M2', 200) + '\n'
  writeFileSync(join(dir, 'asia.ndjson'), content)
  assert.equal(await sealActiveShard(dir, 'asia', 10_000), null)
  assert.ok(existsSync(join(dir, 'asia.ndjson')))

  const sealed = await sealActiveShard(dir, 'asia', 10)
  assert.ok(sealed)
  assert.equal(sealed!.meta.seq, 1)
  assert.equal(sealed!.meta.file, shardFileName(1, 18, 100, 200))
  assert.equal(sealed!.records, 2)
  assert.equal(sealed!.matches, 2)
  assert.equal(sealed!.rawBytes, Buffer.byteLength(content))
  assert.ok(!existsSync(join(dir, 'asia.ndjson')))
  const gz = readFileSync(join(dir, 'asia', sealed!.meta.file))
  assert.equal(gunzipSync(gz).toString('utf8'), content)
  assert.equal(sealed!.meta.gzBytes, statSync(join(dir, 'asia', sealed!.meta.file)).size)

  // 次の封印は seq=2。
  writeFileSync(join(dir, 'asia.ndjson'), rec('M3', 300) + '\n')
  const second = await sealActiveShard(dir, 'asia', 10)
  assert.equal(second!.meta.seq, 2)
})

test('sealAndPrune: 予算超過の古いシャードを削除する', async () => {
  const dir = tmp()
  mkdirSync(join(dir, 'asia'))
  const big = gzipSync(Buffer.from(rec('OLD', 1) + '\n'))
  writeFileSync(join(dir, 'asia', shardFileName(1, 18, 1, 1)), big)
  writeFileSync(join(dir, 'asia', shardFileName(2, 18, 2, 2)), big)
  const { plan, after, sealed } = await sealAndPrune(dir, 'asia', {
    sealThresholdBytes: 1 << 30,
    schedule: [],
    patchesToKeep: 2,
    maxGzBytes: big.length + 1, // 1シャード分だけ
    nowMs: Date.now(),
  })
  assert.equal(sealed, null)
  assert.deepEqual(plan.drop.map((d) => [d.shard.seq, d.reason]), [[1, 'byte-cap']])
  assert.ok(!existsSync(join(dir, 'asia', shardFileName(1, 18, 1, 1))))
  assert.deepEqual(after.sealed.map((s) => s.seq), [2])
})
