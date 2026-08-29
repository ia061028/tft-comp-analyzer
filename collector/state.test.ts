import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterNdjsonForWindow } from './state.ts'

/** 1マッチ分（参加者 n 人）の行を作る。 */
function match(m: string, s: number | undefined, ts: number, n = 2): string[] {
  return Array.from({ length: n }, (_, i) =>
    JSON.stringify(s === undefined ? { m, p: i + 1, ts } : { m, s, p: i + 1, ts }),
  )
}

function ndjson(...groups: string[][]): string {
  return groups.flat().join('\n') + '\n'
}

// ---- 旧セットの切り捨て ----

test('filterNdjsonForWindow: s を持つ行があれば最大セット以外を落とす', () => {
  const content = ndjson(match('A', 17, 100), match('B', 18, 200), match('C', 18, 300))
  const r = filterNdjsonForWindow(content, 0)
  assert.equal(r.targetSet, 18)
  assert.equal(r.droppedOldSet, 2)
  assert.equal(r.kept, 4)
  assert.ok(!r.out.includes('"m":"A"'))
})

test('filterNdjsonForWindow: s を持たない旧レコードも最大セットが決まれば落ちる', () => {
  // セット17時代のレコードは s を持たない。セット18のレコードが入った時点で一掃される。
  const content = ndjson(match('OLD', undefined, 100), match('NEW', 18, 200))
  const r = filterNdjsonForWindow(content, 0)
  assert.equal(r.targetSet, 18)
  assert.equal(r.droppedOldSet, 2)
  assert.ok(!r.out.includes('"m":"OLD"'))
})

test('filterNdjsonForWindow: s を持つ行が皆無なら何も落とさない（全消し防止）', () => {
  const content = ndjson(match('A', undefined, 100), match('B', undefined, 200))
  const r = filterNdjsonForWindow(content, 0)
  assert.equal(r.targetSet, null)
  assert.equal(r.droppedOldSet, 0)
  assert.equal(r.kept, 4)
})

// ---- 窓あふれの切り捨て ----

test('filterNdjsonForWindow: maxRecords を超えたら古いマッチから丸ごと落とす', () => {
  const content = ndjson(match('OLD', 18, 100), match('MID', 18, 200), match('NEW', 18, 300))
  const r = filterNdjsonForWindow(content, 4)
  assert.equal(r.droppedOverflow, 2)
  assert.equal(r.kept, 4)
  assert.ok(r.out.includes('"m":"NEW"'))
  assert.ok(r.out.includes('"m":"MID"'))
  assert.ok(!r.out.includes('"m":"OLD"'))
})

test('filterNdjsonForWindow: マッチを分断しない（予算に収まらないマッチは丸ごと落とす）', () => {
  // 1マッチ4人 × 2マッチ = 8行を maxRecords=6 で切ると、4行は入るが残り2行分は入らない。
  const content = ndjson(match('OLD', 18, 100, 4), match('NEW', 18, 200, 4))
  const r = filterNdjsonForWindow(content, 6)
  assert.equal(r.kept, 4)
  assert.equal(r.droppedOverflow, 4)
  assert.ok(r.out.includes('"m":"NEW"'))
  assert.ok(!r.out.includes('"m":"OLD"'))
})

test('filterNdjsonForWindow: maxRecords=0 は窓の切り詰めをしない', () => {
  const content = ndjson(match('A', 18, 100), match('B', 18, 200))
  const r = filterNdjsonForWindow(content, 0)
  assert.equal(r.droppedOverflow, 0)
  assert.equal(r.kept, 4)
})

test('filterNdjsonForWindow: 収まっていれば1行も落とさない', () => {
  const content = ndjson(match('A', 18, 100), match('B', 18, 200))
  const r = filterNdjsonForWindow(content, 100)
  assert.equal(r.droppedOldSet, 0)
  assert.equal(r.droppedOverflow, 0)
  assert.equal(r.out, content)
})

// ---- 順序・安全側の扱い ----

test('filterNdjsonForWindow: 出力は元の行順を維持する（git delta のため）', () => {
  const content = ndjson(match('A', 18, 300), match('B', 18, 100), match('C', 18, 200))
  const r = filterNdjsonForWindow(content, 4)
  // ts では A(300) > C(200) > B(100)。保持されるのは A と C だが、出力順は元の A→C。
  const idxA = r.out.indexOf('"m":"A"')
  const idxC = r.out.indexOf('"m":"C"')
  assert.ok(idxA >= 0 && idxC >= 0)
  assert.ok(idxA < idxC)
  assert.ok(!r.out.includes('"m":"B"'))
})

test('filterNdjsonForWindow: パース不能行は常に保持し窓の予算も食わない', () => {
  const content = ['not json', ...match('A', 18, 100), ...match('B', 18, 200)].join('\n') + '\n'
  const r = filterNdjsonForWindow(content, 2)
  assert.ok(r.out.includes('not json'))
  // 予算2はマッチ B（2行）に使われ、A は落ちる。不能行は予算外で保持。
  assert.equal(r.kept, 3)
  assert.ok(r.out.includes('"m":"B"'))
  assert.ok(!r.out.includes('"m":"A"'))
})

test('filterNdjsonForWindow: 空行は無視する', () => {
  const content = ['', ...match('A', 18, 100), '', ''].join('\n') + '\n'
  const r = filterNdjsonForWindow(content, 100)
  assert.equal(r.kept, 2)
})

test('filterNdjsonForWindow: 全部落ちたら空文字列', () => {
  const content = ndjson(match('OLD', 17, 100))
  // s=18 の行が無いので targetSet=17 となり何も落ちない。maxRecords で全部落とす。
  const r = filterNdjsonForWindow(content, 0)
  assert.equal(r.kept, 2)
  const r2 = filterNdjsonForWindow(ndjson(match('A', 17, 100), match('B', 18, 200)), 0)
  assert.equal(r2.targetSet, 18)
  assert.equal(r2.kept, 2)
})
