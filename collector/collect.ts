import 'dotenv/config'

// Phase 1: APIキー・DTO・配線の疎通確認のみ。
// Phase 2 でリーグ→puuid→マッチID→マッチ詳細→NDJSON追記のパイプラインに置き換える。

const apiKey = process.env.RIOT_API_KEY
if (!apiKey) {
  console.error('RIOT_API_KEY が未設定です。.env を確認してください（.env.example 参照）')
  process.exit(1)
}

const res = await fetch('https://sg2.api.riotgames.com/tft/league/v1/challenger', {
  headers: { 'X-Riot-Token': apiKey },
})
if (!res.ok) {
  console.error(`Riot API エラー: ${res.status} ${res.statusText}`)
  process.exit(1)
}

const league = (await res.json()) as {
  tier: string
  entries: { puuid?: string; leaguePoints: number }[]
}

console.log(`sg2 ${league.tier}: ${league.entries.length} 人`)
console.log(`先頭エントリの puuid: ${league.entries[0]?.puuid ?? '(puuid なし)'}`)
