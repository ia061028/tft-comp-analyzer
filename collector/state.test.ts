import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterNdjsonByPatch } from './state.ts'

function line(v: string): string {
  return JSON.stringify({ m: 'M_' + v, v, p: 1 })
}

test('filterNdjsonByPatch: keep に含まれる行だけ残す', () => {
  const content = [line('16.12'), line('16.11'), line('16.10')].join('\n') + '\n'
  const keep = new Set(['16.12', '16.11'])
  const { out, kept, dropped } = filterNdjsonByPatch(content, keep)
  assert.equal(kept, 2)
  assert.equal(dropped, 1)
  assert.ok(out.includes('16.12'))
  assert.ok(out.includes('16.11'))
  assert.ok(!out.includes('16.10'))
  assert.ok(out.endsWith('\n'))
})

test('filterNdjsonByPatch: dropped=0 のとき全行保持', () => {
  const content = [line('16.12'), line('16.11')].join('\n') + '\n'
  const keep = new Set(['16.12', '16.11'])
  const { kept, dropped } = filterNdjsonByPatch(content, keep)
  assert.equal(kept, 2)
  assert.equal(dropped, 0)
})

test('filterNdjsonByPatch: パース不能行は保持（安全側）', () => {
  const content = ['not json', line('16.10')].join('\n') + '\n'
  const keep = new Set(['16.12'])
  const { out, kept, dropped } = filterNdjsonByPatch(content, keep)
  // 不能行は保持（kept）、16.10 は keep 外なので drop。
  assert.equal(kept, 1)
  assert.equal(dropped, 1)
  assert.ok(out.includes('not json'))
})

test('filterNdjsonByPatch: v が無い行は drop', () => {
  const content = [JSON.stringify({ m: 'x', p: 1 }), line('16.12')].join('\n') + '\n'
  const keep = new Set(['16.12'])
  const { kept, dropped } = filterNdjsonByPatch(content, keep)
  assert.equal(kept, 1)
  assert.equal(dropped, 1)
})

test('filterNdjsonByPatch: 空行は無視', () => {
  const content = '\n' + line('16.12') + '\n\n'
  const keep = new Set(['16.12'])
  const { kept, dropped, out } = filterNdjsonByPatch(content, keep)
  assert.equal(kept, 1)
  assert.equal(dropped, 0)
  assert.equal(out, line('16.12') + '\n')
})

test('filterNdjsonByPatch: 全 drop なら空文字列', () => {
  const content = line('16.10') + '\n'
  const keep = new Set(['16.12'])
  const { out, kept, dropped } = filterNdjsonByPatch(content, keep)
  assert.equal(kept, 0)
  assert.equal(dropped, 1)
  assert.equal(out, '')
})
