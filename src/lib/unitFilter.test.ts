import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompStats } from '../../shared/types'
import { cycleMark, filterByUnits, nextMark, type UnitMark } from './unitFilter'

function comp(units: number[]): CompStats {
  return {
    units,
    n: 0,
    unitStars: [],
    unitItems: [],
    holders: [],
    sigs: [],
    grants: [],
    slotExtra: 0,
  }
}

const units = [{ api: 'A' }, { api: 'B' }, { api: 'C' }, { api: 'D' }]
const comps = [comp([0, 1]), comp([0, 2]), comp([1, 2]), comp([0, 1, 2])]
const marks = (entries: [string, UnitMark][]) => new Map(entries)
const boards = (cs: CompStats[]) => cs.map((c) => c.units.join(''))

test('filterByUnits: 印が無ければそのまま返す', () => {
  assert.equal(filterByUnits(comps, units, new Map()), comps)
})

test('filterByUnits: 使うに選んだ駒が全員居る構成だけを残す', () => {
  assert.deepEqual(boards(filterByUnits(comps, units, marks([['A', 'use']]))), ['01', '02', '012'])
  assert.deepEqual(
    boards(
      filterByUnits(
        comps,
        units,
        marks([
          ['A', 'use'],
          ['B', 'use'],
        ]),
      ),
    ),
    ['01', '012'],
  )
})

test('filterByUnits: 使わないに選んだ駒が1体でも居る構成を外す', () => {
  assert.deepEqual(boards(filterByUnits(comps, units, marks([['C', 'avoid']]))), ['01'])
  assert.deepEqual(
    boards(
      filterByUnits(
        comps,
        units,
        marks([
          ['A', 'use'],
          ['C', 'avoid'],
        ]),
      ),
    ),
    ['01'],
  )
})

test('filterByUnits: このファイルに居ない駒の印は無視する', () => {
  assert.equal(filterByUnits(comps, units, marks([['Z', 'use']])), comps)
})

test('nextMark / cycleMark: 印なし → 使う → 使わない → 印なし', () => {
  assert.equal(nextMark(undefined), 'use')
  assert.equal(nextMark('use'), 'avoid')
  assert.equal(nextMark('avoid'), undefined)

  const m0 = new Map<string, UnitMark>()
  const m1 = cycleMark(m0, 'A')
  const m2 = cycleMark(m1, 'A')
  const m3 = cycleMark(m2, 'A')
  assert.equal(m0.size, 0) // 元の Map は変えない
  assert.equal(m1.get('A'), 'use')
  assert.equal(m2.get('A'), 'avoid')
  assert.equal(m3.has('A'), false)
})
