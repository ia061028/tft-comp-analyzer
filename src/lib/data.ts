import type { StatsFile, WireStatsFile, WireComp, CompStats, EmblemSig } from '../../shared/types'

function decodeComp(c: WireComp): CompStats {
  const sigs: EmblemSig[] = c.g.map(([e, n, top4, win, p]) => ({ e, n, top4, win, p }))
  return {
    units: c.u,
    n: c.n,
    unitStars: c.k ?? c.u.map(() => 0),
    unitItems: c.i ?? [],
    holders: c.h ?? [],
    sigs,
  }
}

function decodeStats(w: WireStatsFile): StatsFile {
  return {
    schemaVersion: w.schemaVersion,
    generatedAt: w.generatedAt,
    patch: w.patch,
    tftPatch: w.tftPatch,
    setNumber: w.setNumber,
    totals: w.totals,
    traits: w.traits,
    emblems: w.emblems,
    units: w.units,
    items: w.items,
    comps: w.comps.map(decodeComp),
    baseItemIcons: w.baseItemIcons,
  }
}

/** data/stats.json を実行時fetchしてパース・復元する。非OKレスポンスはthrow。
 * BASE_URL 基準（Cloudflare Pages ルート配信）。 */
export async function loadStats(): Promise<StatsFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/stats.json`)
  if (!res.ok) {
    throw new Error(`stats.json fetch failed (${res.status} ${res.statusText})`)
  }
  return decodeStats((await res.json()) as WireStatsFile)
}
