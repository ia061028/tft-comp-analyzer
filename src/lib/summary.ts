// 統計ページ（summary.json）の読み込みと、表の行の組み立て。
import type { WireRecordStat, WireSummaryFile, WireSummaryView } from '../../shared/types'
import { pickName, type Lang } from './i18n'
import { PRIOR_PLACE, shrunk } from './format'

export const SUMMARY_FILE = 'summary.json'

/** summary.json が無い（まだ集計が回っていない）ときは null。 */
export async function loadSummary(): Promise<WireSummaryFile | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${SUMMARY_FILE}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${SUMMARY_FILE} fetch failed (${res.status} ${res.statusText})`)
  return (await res.json()) as WireSummaryFile
}

export interface StatRow {
  key: string
  name: string
  icon: string
  /** 特性の行だけ: 段の下限体数と、その段の style（1=ブロンズ … 4=プリズム）。 */
  min?: number
  style?: number
  n: number
  avg: number
  /** 0〜100 */
  top4: number
  win: number
  lv: number
  /** ビューの参加者に占める割合（0〜100）。 */
  share: number
  /**
   * 並び順に使う平均順位。構成一覧と同じ縮約（仮想10試合ぶん 4.5 に寄せる）。
   * 採用が少ないこと自体では下げない。人数が十分な行はほぼ生の値のまま。
   */
  rank: number
}

function toRow(
  base: Pick<StatRow, 'key' | 'name' | 'icon' | 'min' | 'style'>,
  s: WireRecordStat,
  participants: number,
): StatRow {
  const [n, p, top4, win, lv] = s
  return {
    ...base,
    n,
    avg: p / n,
    top4: (top4 / n) * 100,
    win: (win / n) * 100,
    lv: lv / n,
    share: participants > 0 ? (n / participants) * 100 : 0,
    rank: shrunk(p, n, PRIOR_PLACE),
  }
}

export function emblemRows(file: WireSummaryFile, view: WireSummaryView, lang: Lang): StatRow[] {
  return view.emblems
    .filter(([, s]) => s[0] > 0)
    .map(([i, s]) => {
      const e = file.emblems[i]
      // 見出しが「紋章」なので名前は特性名だけにする（「〜の紋章」を毎行繰り返すと狭い画面で列が押し出される）。
      const name = pickName(lang, file.traits[e.trait] ?? e)
      return toRow({ key: e.api, name, icon: e.icon }, s, view.participants)
    })
}

/** 紋章を活用していない参加者の行（紋章の表の最後に置く比較用）。 */
export function noEmblemRow(view: WireSummaryView, name: string): StatRow | null {
  return view.noEmblem[0] > 0 ? toRow({ key: 'none', name, icon: '' }, view.noEmblem, view.participants) : null
}

export type TraitSplit = 'all' | 'with' | 'without'

export function traitRows(
  file: WireSummaryFile,
  view: WireSummaryView,
  lang: Lang,
  split: TraitSplit,
  includeUnique: boolean,
): StatRow[] {
  const col = split === 'all' ? 2 : split === 'with' ? 3 : 4
  const rows: StatRow[] = []
  for (const r of view.traits) {
    const [ti, min] = r
    const s = r[col] as WireRecordStat
    if (s[0] === 0) continue
    const t = file.traits[ti]
    // 固有特性 ＝ 段が1つしかない特性（生涯ブロンズの bronzeTraitCount と同じ定義）。
    if (!includeUnique && t.tiers.length < 2) continue
    const style = t.tiers.find(([m]) => m === min)?.[1]
    rows.push(toRow({ key: `${t.api}|${min}`, name: pickName(lang, t), icon: t.icon, min, style }, s, view.participants))
  }
  return rows
}

export type StatSortKey = 'name' | 'avg' | 'top4' | 'win' | 'lv' | 'share'

/** 押したときの向き。平均順位と名前は小さい方が先、それ以外は大きい方が先。 */
export function defaultDir(key: StatSortKey): 1 | -1 {
  return key === 'avg' || key === 'name' ? 1 : -1
}

export function sortRows(rows: StatRow[], key: StatSortKey, dir: 1 | -1, lang: Lang): StatRow[] {
  const val = (r: StatRow): number => (key === 'avg' ? r.rank : key === 'name' ? 0 : r[key])
  return [...rows].sort((a, b) => {
    if (key === 'name') {
      const c = a.name.localeCompare(b.name, lang)
      return (c || (a.min ?? 0) - (b.min ?? 0)) * dir
    }
    return (val(a) - val(b)) * dir || a.rank - b.rank
  })
}

/**
 * 平均順位の色。全参加者の平均 4.5 からの差を、構成一覧と同じ灯の段で表す
 * （tokens.css: 差 >= 0.8 hot / >= 0.3 warm / それ未満 cold）。
 */
export function placeTone(avg: number): 'hot' | 'warm' | 'cold' {
  const d = PRIOR_PLACE - avg
  return d >= 0.8 ? 'hot' : d >= 0.3 ? 'warm' : 'cold'
}
