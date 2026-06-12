import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, pickTargetPatch, patchesToKeep } from './patches.ts'

test('compareVersions: "16.9" < "16.10"（数値比較）', () => {
  assert.ok(compareVersions('16.9', '16.10') < 0)
  assert.ok(compareVersions('16.10', '16.9') > 0)
})

test('compareVersions: 等値は 0', () => {
  assert.equal(compareVersions('16.12', '16.12'), 0)
})

test('compareVersions: メジャー差を優先', () => {
  assert.ok(compareVersions('17.1', '16.99') > 0)
})

test('compareVersions: パース不能は最小扱い', () => {
  assert.ok(compareVersions('garbage', '16.1') < 0)
  assert.ok(compareVersions('16.1', 'garbage') > 0)
  // 両方パース不能なら等値。
  assert.equal(compareVersions('garbage', 'nonsense'), 0)
})

test('pickTargetPatch: 新パッチが閾値未満なら旧パッチを維持（ヒステリシスの核心）', () => {
  // 16.12 は新しいが 50 < 200。16.11 は 300 >= 200。降順走査で 16.12 を飛ばし 16.11 を選ぶ。
  const m = new Map([
    ['16.11', 300],
    ['16.12', 50],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.11')
})

test('pickTargetPatch: 新パッチが閾値到達で切替', () => {
  const m = new Map([
    ['16.11', 300],
    ['16.12', 250],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.12')
})

test('pickTargetPatch: 全部閾値未達ならマッチ数最多', () => {
  const m = new Map([
    ['16.11', 120],
    ['16.12', 80],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.11')
})

test('pickTargetPatch: 全部未達・同数ならバージョン新しい方', () => {
  const m = new Map([
    ['16.11', 100],
    ['16.12', 100],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.12')
})

test('pickTargetPatch: 空 Map は null', () => {
  assert.equal(pickTargetPatch(new Map(), 200), null)
})

test('pickTargetPatch: 実 sea データ相当（16.12=651 >= 200 で 16.12）', () => {
  const m = new Map([
    ['16.12', 651],
    ['16.11', 494],
    ['16.10', 43],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.12')
})

test('patchesToKeep: 3パッチ→上位2', () => {
  const keep = patchesToKeep(['16.10', '16.12', '16.11'])
  assert.deepEqual([...keep].sort(), ['16.11', '16.12'])
})

test('patchesToKeep: 1パッチ→そのまま', () => {
  const keep = patchesToKeep(['16.12'])
  assert.deepEqual([...keep], ['16.12'])
})

test('patchesToKeep: 重複は畳んで上位2', () => {
  const keep = patchesToKeep(['16.12', '16.12', '16.11', '16.10'])
  assert.deepEqual([...keep].sort(), ['16.11', '16.12'])
})
