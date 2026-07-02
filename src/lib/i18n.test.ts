import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpolate } from './i18n'

test('interpolate: 同一プレースホルダが2回出現しても両方置換される', () => {
  assert.equal(interpolate('{n} of {n}', { n: 3 }), '3 of 3')
})

test('interpolate: vars なしはそのまま返す', () => {
  assert.equal(interpolate('plain text'), 'plain text')
  assert.equal(interpolate('{n} unresolved'), '{n} unresolved')
})

test('interpolate: 複数キーをそれぞれ置換', () => {
  assert.equal(interpolate('{a}-{b}-{a}', { a: 'x', b: 'y' }), 'x-y-x')
})
