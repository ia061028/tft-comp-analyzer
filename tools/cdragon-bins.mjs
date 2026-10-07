// 各ユニットのゲーム bin（スキル数値・基礎ステータス）を版ごとに取得する。CDragon の tft json はセット18のスキル変数が空のため。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const out = process.argv[2] ?? 'snapshots'
const versions = (process.argv[3] ?? '16.19,16.20').split(',')
const BASE = 'https://raw.communitydragon.org'
const KEEP = /SpellObject|CharacterRecord|SpellDataResource/

async function get(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

function slim(bin) {
  const o = {}
  for (const [k, v] of Object.entries(bin)) if (KEEP.test(v?.__type ?? '')) o[k] = v
  return o
}

for (const v of versions) {
  const champs = JSON.parse(readFileSync(`${out}/${v}/en_us.json`, 'utf8')).champions
  // どのディレクトリ構成かを listing で確認する
  for (const p of ['game/characters/', 'game/data/characters/']) {
    try {
      const l = await get(`${BASE}/json/${v}/${p}`)
      writeFileSync(`${out}/${v}/listing-${p.replaceAll('/', '_')}.json`, JSON.stringify(l.map((e) => e.name)))
    } catch (e) {
      console.log('nolist', v, p, String(e))
    }
  }
  mkdirSync(`${out}/${v}/bins`, { recursive: true })
  const miss = []
  for (const c of champs) {
    const n = (c.characterName ?? c.apiName).toLowerCase()
    let ok = false
    for (const u of [
      `${BASE}/${v}/game/characters/${n}/${n}.cdtb.bin.json`,
      `${BASE}/${v}/game/data/characters/${n}/${n}.bin.json`,
      `${BASE}/${v}/game/data/characters/${n}/${n}.cdtb.bin.json`,
    ]) {
      try {
        writeFileSync(`${out}/${v}/bins/${n}.json`, JSON.stringify(slim(await get(u)), null, 1))
        ok = true
        break
      } catch {}
    }
    if (!ok) miss.push(n)
  }
  console.log(v, 'missing', miss.length, miss.join(' '))
}
