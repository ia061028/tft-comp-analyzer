// CDragon の TFT 静的データ（live と直近の版）からセット18のユニット・特性だけを抜き出して保存する。
import { mkdirSync, writeFileSync } from 'node:fs'

const out = process.argv[2] ?? 'snapshots'
const BASE = 'https://raw.communitydragon.org'

async function get(url, json = true) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return json ? r.json() : r.text()
}

const listing = await get(`${BASE}/json/`)
mkdirSync(out, { recursive: true })
writeFileSync(`${out}/listing.json`, JSON.stringify(listing, null, 1))
const numeric = listing
  .filter((e) => e.type === 'directory' && /^\d+\.\d+$/.test(e.name))
  .sort((a, b) => {
    const [a1, a2] = a.name.split('.').map(Number)
    const [b1, b2] = b.name.split('.').map(Number)
    return a1 - b1 || a2 - b2
  })
const versions = ['latest', 'pbe', ...numeric.slice(-3).map((e) => e.name)]

for (const v of versions) {
  for (const lang of ['en_us', 'ja_jp']) {
    try {
      const data = await get(`${BASE}/${v}/cdragon/tft/${lang}.json`)
      const sets = data.setData ?? []
      const set = sets.filter((s) => s.number === 18).sort((a, b) => (b.champions?.length ?? 0) - (a.champions?.length ?? 0))[0]
      const meta = await get(`${BASE}/${v}/content-metadata.json`).catch(() => null)
      mkdirSync(`${out}/${v}`, { recursive: true })
      writeFileSync(
        `${out}/${v}/${lang}.json`,
        JSON.stringify({ version: v, meta, mutator: set?.mutator, champions: set?.champions ?? [], traits: set?.traits ?? [] }, null, 1),
      )
      console.log(v, lang, set?.mutator, set?.champions?.length)
    } catch (e) {
      console.log('skip', v, lang, String(e))
    }
  }
}
