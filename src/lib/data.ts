import type { StatsFile, WireStatsFile, WireComp, CompStats, EmblemSig, PatchIndexEntry } from '../../shared/types'

/** フロントが最初に読む既定ビューのファイル名（集計側の既定パッチ）。 */
export const DEFAULT_STATS_FILE = 'stats.json'

/** 全パッチ合算ビューの選択キー（集計側 ALL_PATCHES_KEY と対応）。 */
export const ALL_PATCHES_KEY = 'all'

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

/**
 * patches 一覧を正規化する。旧ファイル（patches 欠落）は「このファイルだけの単一ビュー」として扱う。
 * ファイル名は URL のパス区切りを含まないものだけ信用する（データファイル由来なので念のため）。
 */
function decodePatches(w: WireStatsFile, file: string): PatchIndexEntry[] {
  const list = (w.patches ?? []).filter((p) => p.file && !p.file.includes('/') && !p.file.includes('\\'))
  if (list.length > 0) return list
  return [{ key: w.patch, label: w.tftPatch, file, matches: w.totals.matches }]
}

function decodeStats(w: WireStatsFile, file: string): StatsFile {
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
    patches: decodePatches(w, file),
  }
}

/** data/{file} を実行時fetchしてパース・復元する。非OKレスポンスはthrow。
 * BASE_URL 基準（Cloudflare Pages ルート配信）。 */
export async function loadStats(file: string = DEFAULT_STATS_FILE): Promise<StatsFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  if (!res.ok) {
    throw new Error(`${file} fetch failed (${res.status} ${res.statusText})`)
  }
  return decodeStats((await res.json()) as WireStatsFile, file)
}

/**
 * 紋章選択（emblems 配列インデックスの多重集合）を別ファイルのインデックス体系へ写す。
 * 紋章の intern はファイルごとに「レコードに現れた紋章」だけなので、同じ紋章でも
 * インデックスが変わりうる。apiName で突き合わせ、移行先に無い紋章は落とす。
 */
export function remapSelection(
  selection: number[],
  from: { api: string }[],
  to: { api: string }[],
): number[] {
  const toIndex = new Map<string, number>()
  to.forEach((e, i) => toIndex.set(e.api, i))
  const out: number[] = []
  for (const idx of selection) {
    const api = from[idx]?.api
    if (api === undefined) continue
    const next = toIndex.get(api)
    if (next !== undefined) out.push(next)
  }
  return out
}
