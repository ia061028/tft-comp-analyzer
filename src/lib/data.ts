import type {
  StatsFile,
  WireStatsFile,
  WireComp,
  CompStats,
  EmblemRow,
  TraitInfo,
} from '../../shared/types'

/** traits ペアから label/labelJa を復元（aggregate と同一順序: style 降順→英語名昇順）。 */
function buildLabels(
  traits: [number, number][],
  dict: TraitInfo[],
): { label: string; labelJa: string } {
  const parts = traits
    .map(([idx, style]) => ({ name: dict[idx].name, nameJa: dict[idx].nameJa, style }))
    .sort((a, b) => (b.style !== a.style ? b.style - a.style : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return {
    label: parts.map((p) => p.name).join(' / '),
    labelJa: parts.map((p) => p.nameJa).join(' / '),
  }
}

/** 圧縮形式の WireComp をリッチな CompStats へ復元。 */
function decodeComp(c: WireComp, traits: TraitInfo[]): CompStats {
  const { label, labelJa } = buildLabels(c.t, traits)
  const rows: EmblemRow[] = (c.r ?? []).map(([e, n, top4, win, p]) => ({ e, n, top4, win, p }))
  return {
    traits: c.t,
    synergies: c.s ?? [],
    label,
    labelJa,
    units: c.u,
    unitStars: c.k ?? c.u.map(() => 0),
    n: c.n,
    top4: c.q,
    win: c.w,
    rows,
    holders: c.h ?? [],
    unitItems: c.i ?? [],
  }
}

/** オンディスク圧縮形式（WireStatsFile）をフロント内部の StatsFile へ復元。 */
function decodeStats(w: WireStatsFile): StatsFile {
  const compsByLevel: Record<string, CompStats[]> = {}
  for (const [lv, comps] of Object.entries(w.compsByLevel ?? {})) {
    compsByLevel[lv] = comps.map((c) => decodeComp(c, w.traits))
  }
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
    comps: w.comps.map((c) => decodeComp(c, w.traits)),
    compsByLevel,
    baseItemIcons: w.baseItemIcons,
  }
}

/** data/stats.json を実行時fetchしてパース・復元する。非OKレスポンスはthrow。
 * BASE_URL 基準にすることで GitHub Pages の project サブパス配信に対応。 */
export async function loadStats(): Promise<StatsFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/stats.json`)
  if (!res.ok) {
    throw new Error(`stats.json fetch failed (${res.status} ${res.statusText})`)
  }
  return decodeStats((await res.json()) as WireStatsFile)
}
