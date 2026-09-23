import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WireStatsFile } from '../../shared/types'
import { serializeStatsFile } from '../../collector/aggregate-core.ts'
import { StatsStreamParser } from './statsStream.ts'

function file(n: number): WireStatsFile {
  return {
    schemaVersion: 8,
    generatedAt: 'T',
    patch: '18.3',
    tftPatch: '18.3',
    setNumber: 18,
    totals: { matches: 1, participants: 8, byRoute: { sea: 8 } },
    traits: [],
    emblems: [{ api: 'E', name: 'E', nameJa: 'え', trait: 0, icon: 'e.png', base: 'spatula' }],
    units: [],
    items: [],
    compCount: n,
    comps: Array.from({ length: n }, (_, k) => ({
      u: [k, k + 1],
      n: 3 + k,
      g: [[[0], 1, 1, 0, 3]],
      i: [[k, 2, 5]],
      h: [[0, k]],
    })),
    granters: [],
    patches: [{ key: '18.3', label: '18.3', file: 'stats.json', matches: 1 }],
  }
}

/** 文字列を size 文字ずつに切って流す。 */
function feed(text: string, size: number): StatsStreamParser {
  const p = new StatsStreamParser()
  for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size))
  return p
}

test('serializeStatsFile: そのまま JSON.parse でき、comps は1行に1つで最後に来る', () => {
  const f = file(3)
  const text = serializeStatsFile(f)
  assert.deepEqual(JSON.parse(text), f)
  const lines = text.split('\n')
  assert.equal(lines.length, 5)
  assert.ok(lines[0].endsWith('"comps":['))
  assert.equal(lines[4], ']}')
})

test('serializeStatsFile: 構成0件でも JSON として読める', () => {
  const f = file(0)
  assert.deepEqual(JSON.parse(serializeStatsFile(f)), f)
  assert.deepEqual(feed(serializeStatsFile(f), 7).finish(), f)
})

test('StatsStreamParser: どこで切れて届いても同じものを復元する', () => {
  const f = file(50)
  const text = serializeStatsFile(f)
  for (const size of [1, 3, 17, 100, text.length]) {
    assert.deepEqual(feed(text, size).finish(), f, `size=${size}`)
  }
})

test('StatsStreamParser: 1行目が届いた時点で辞書を返し、構成は届いた分だけ数える', () => {
  const text = serializeStatsFile(file(10))
  const p = new StatsStreamParser()
  const firstNl = text.indexOf('\n')
  p.push(text.slice(0, firstNl))
  assert.equal(p.head, null)
  p.push('\n')
  assert.deepEqual(p.head?.emblems.map((e) => e.api), ['E'])
  assert.equal(p.head?.comps.length, 0)
  assert.equal(p.head?.compCount, 10)
  const secondNl = text.indexOf('\n', firstNl + 1)
  const thirdNl = text.indexOf('\n', secondNl + 1)
  p.push(text.slice(firstNl + 1, thirdNl + 1))
  assert.equal(p.received, 2)
})

test('StatsStreamParser: 1行の旧ファイル（schemaVersion 7）は丸ごと読む', () => {
  const old = { ...file(4), schemaVersion: 7 }
  assert.deepEqual(feed(JSON.stringify(old), 5).finish(), old)
  // 整形された JSON（1行目が別の形）も丸ごと読む。
  assert.deepEqual(feed(JSON.stringify(old, null, 2), 11).finish(), old)
})

test('StatsStreamParser: 途中で切れたファイルは throw する', () => {
  const text = serializeStatsFile(file(5))
  const cut = text.slice(0, text.lastIndexOf('\n'))
  assert.throws(() => feed(cut, 9).finish(), /ended early/)
})
