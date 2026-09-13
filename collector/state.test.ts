import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shouldResetSeen, ensureDataGitattributes, DATA_GITATTRIBUTES } from './state.ts'

// ---- shouldResetSeen ----

test('shouldResetSeen: meta に値が無ければリセットしない（旧レイアウトからの移行）', () => {
  assert.equal(shouldResetSeen(undefined, 1787702400), false)
})

test('shouldResetSeen: 同値ならリセットしない', () => {
  assert.equal(shouldResetSeen(1787702400, 1787702400), false)
})

test('shouldResetSeen: 値が変わっていればリセットする（セット切替）', () => {
  assert.equal(shouldResetSeen(1787702400, 1795000000), true)
})

// ---- ensureDataGitattributes ----

test('ensureDataGitattributes: 無ければ書き、同内容なら触らない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tft-state-'))
  const path = join(dir, '.gitattributes')
  assert.equal(ensureDataGitattributes(path), true)
  assert.ok(existsSync(path))
  assert.equal(readFileSync(path, 'utf8'), DATA_GITATTRIBUTES)
  assert.equal(ensureDataGitattributes(path), false)
})

test('ensureDataGitattributes: 旧内容（gz 行なし）は上書きする', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tft-state-'))
  const path = join(dir, '.gitattributes')
  writeFileSync(path, '*.ndjson text eol=lf\n*.json text eol=lf\n')
  assert.equal(ensureDataGitattributes(path), true)
  assert.match(readFileSync(path, 'utf8'), /\*\.gz binary/)
})
