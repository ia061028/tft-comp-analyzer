import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EmblemContext } from './cdragon.ts'

// collect.ts はモジュール読み込み時に RIOT_API_KEY を要求して未設定なら exit する。
// テストでは収集を一切行わない（エントリガードにより main は走らない）ので、ダミー値を入れてから import する。
process.env.RIOT_API_KEY ??= 'RGAPI-test-key-not-used'
const { buildRecords } = await import('./collect.ts')

/** セット18 相当の紋章コンテキスト（getEmblemContext の出力を手で組んだもの）。 */
function makeEmblemCtx(): EmblemContext {
  return {
    // セット18 の紋章は CDragon 上 incompatibleTraits が空だが、
    // アイコン置き場＋"... Emblem" 名で紋章と判定され、この集合に入る。
    emblemSet: new Set(['DA_18_EmblemVanguard']),
    knownItems: new Set([
      'DA_18_EmblemVanguard',
      'DA_RedBuff',
      'DA_SpearOfShojin',
      'DA_Component_BFSword',
    ]),
    // 紋章は完成アイテムに含めない（推奨アイテム欄に紋章が混ざらないこと）。
    completedItems: new Set(['DA_RedBuff', 'DA_SpearOfShojin']),
  }
}

/** Riot match-v1 の最小サブセット。buildRecords が読むフィールドのみ。 */
function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    info: {
      queue_id: 1100,
      tft_game_type: 'standard',
      game_version: 'Version 16.17.700.1234 (Aug 26 2026/...)',
      tft_set_number: 18,
      game_datetime: 1787000000000,
      participants: [
        {
          placement: 1,
          level: 9,
          traits: [
            { name: 'DA_18_Vanguard', tier_current: 2, style: 3, num_units: 4 },
            { name: 'DA_18_Elderwood', tier_current: 0, style: 0, num_units: 1 },
          ],
          units: [
            {
              character_id: 'DA_Gromp18_AP',
              tier: 2,
              itemNames: ['DA_RedBuff', 'DA_18_EmblemVanguard', 'DA_SpearOfShojin'],
            },
            { character_id: 'DA_Murkwolf18', tier: 3, itemNames: [] },
          ],
        },
      ],
      ...overrides,
    },
  }
}

test('buildRecords: セット18 の紋章が e/eh に入り、完成アイテム(ui)には混ざらない', () => {
  const recs = buildRecords('VN2_1', makeDetail() as never, makeEmblemCtx())
  assert.ok(recs !== null)
  assert.equal(recs.length, 1)
  const r = recs[0]
  assert.deepEqual(r.e, ['DA_18_EmblemVanguard'])
  assert.deepEqual(r.eh, ['DA_Gromp18_AP'])
  assert.deepEqual(r.ui, [['DA_RedBuff', 'DA_SpearOfShojin'], []])
})

test('buildRecords: tft_set_number を s に記録する', () => {
  const recs = buildRecords('VN2_1', makeDetail() as never, makeEmblemCtx())
  assert.ok(recs !== null)
  assert.equal(recs[0].s, 18)
})

test('buildRecords: tft_set_number が無い場合 s は undefined', () => {
  const detail = makeDetail() as unknown as { info: Record<string, unknown> }
  delete detail.info.tft_set_number
  const recs = buildRecords('VN2_1', detail as never, makeEmblemCtx())
  assert.ok(recs !== null)
  assert.equal(recs[0].s, undefined)
})

test('buildRecords: game_version から major.minor を取り出す', () => {
  const recs = buildRecords('VN2_1', makeDetail() as never, makeEmblemCtx())
  assert.ok(recs !== null)
  assert.equal(recs[0].v, '16.17')
})

test('buildRecords: TFT表記の game_version でもそのまま major.minor を取る', () => {
  // Unreal 移行後に game_version が TFT 表記になった場合も壊れないこと。
  const recs = buildRecords(
    'VN2_1',
    makeDetail({ game_version: 'Version 18.1.700.1234' }) as never,
    makeEmblemCtx(),
  )
  assert.ok(recs !== null)
  assert.equal(recs[0].v, '18.1')
})

test('buildRecords: 発動トレイトのみ t/tc に入る', () => {
  const recs = buildRecords('VN2_1', makeDetail() as never, makeEmblemCtx())
  assert.ok(recs !== null)
  assert.deepEqual(recs[0].t, { DA_18_Vanguard: 3 })
  assert.deepEqual(recs[0].tc, { DA_18_Vanguard: 4 })
})

test('buildRecords: ランク戦(1100)/standard 以外は null', () => {
  assert.equal(buildRecords('VN2_1', makeDetail({ queue_id: 1090 }) as never, makeEmblemCtx()), null)
  assert.equal(
    buildRecords('VN2_1', makeDetail({ tft_game_type: 'turbo' }) as never, makeEmblemCtx()),
    null,
  )
})

test('buildRecords: CDragon が知らないアイテムは紋章候補として拾う（パッチ追従遅延対策）', () => {
  const detail = makeDetail() as unknown as {
    info: { participants: { units: { itemNames: string[] }[] }[] }
  }
  detail.info.participants[0].units[1].itemNames = ['DA_18_EmblemUnknownBrandNew']
  const recs = buildRecords('VN2_1', detail as never, makeEmblemCtx())
  assert.ok(recs !== null)
  assert.deepEqual(recs[0].e, ['DA_18_EmblemVanguard', 'DA_18_EmblemUnknownBrandNew'])
  assert.deepEqual(recs[0].eh, ['DA_Gromp18_AP', 'DA_Murkwolf18'])
})
