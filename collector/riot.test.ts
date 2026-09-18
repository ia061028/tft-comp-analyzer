import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RiotClient } from './riot.ts'

/** ボディ途中で切断される 200 応答（undici の "TypeError: terminated" 相当）。 */
function truncatedResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"entries":['))
      controller.error(new TypeError('terminated'))
    },
  })
  return new Response(body, { status: 200 })
}

test('RiotClient.get: 200 応答のボディ受信中に切断されたら再試行する', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return calls === 1 ? truncatedResponse() : Response.json({ entries: [1, 2, 3] })
  })

  const client = new RiotClient('RGAPI-test')
  const got = await client.get<{ entries: number[] }>('https://vn2.api.riotgames.com/tft/league/v1/master')

  assert.deepEqual(got, { entries: [1, 2, 3] })
  assert.equal(calls, 2)
})
