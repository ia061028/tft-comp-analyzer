// 統計ページの掘り下げ（drill-<ビュー>.json）。特性の行を押したときに、そのビューの分だけ読む。
import type { LevelKey, WireDrillFile, WireDrillType, WireSummaryFile } from '../../shared/types'
import { pickName, type Lang } from './i18n'
import type { TraitSplit } from './summary'

/** drill-<key>.json が無い（まだ集計が回っていない）ときは null。 */
export async function loadDrill(key: string): Promise<WireDrillFile | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/drill-${key}.json`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`drill-${key}.json fetch failed (${res.status} ${res.statusText})`)
  return (await res.json()) as WireDrillFile
}

export interface DrillUnit {
  api: string
  name: string
  icon: string
  cost: number
  /** 型の中での採用率（0〜100） */
  share: number
  n: number
  /** 採用した人のうち星3の割合（0〜100） */
  star3: number
  star3Avg: number | null
  otherAvg: number | null
}

export interface DrillType {
  key: string
  /** 相方特性。null はまとめ行（その他）、undefined は相方なし。 */
  partner: { name: string; icon: string } | null | undefined
  n: number
  /** 特性行の人数に占める割合（0〜100） */
  share: number
  avg: number
  top4: number
  lv: number
  board: { name: string; icon: string; cost: number }[]
  boardN: number
  boardAvg: number
  units: DrillUnit[]
}

const SPLIT_COL: Record<TraitSplit, 0 | 1 | 2> = { all: 0, with: 1, without: 2 }

/**
 * 特性の段（summary.json の行キー）の型一覧。人数の多い順（まとめ行は最後）。
 * 相方特性は api で summary.json の特性に引き当てる（ファイル間で並びがずれても名前を取り違えない）。
 * レベルを選んでいるときの盤面は、そのレベルで終えた人の最多の盤面（駒の数がレベルに合う）。
 */
export function drillTypes(
  drill: WireDrillFile,
  summary: WireSummaryFile,
  traitApi: string,
  min: number,
  split: TraitSplit,
  lang: Lang,
  level: 'all' | LevelKey = 'all',
): DrillType[] {
  const ti = drill.traits.indexOf(traitApi)
  const row = drill.rows.find((r) => r.t === ti && r.m === min)
  if (!row) return []
  const types = row.sp[SPLIT_COL[split]]
  const total = types.reduce((s, ty) => s + ty.s[0], 0)
  const traitByApi = new Map(summary.traits.map((t) => [t.api, t]))
  return types.map((ty, i) => toType(ty, i, total, drill, traitByApi, lang, level))
}

function toType(
  ty: WireDrillType,
  i: number,
  total: number,
  drill: WireDrillFile,
  traitByApi: Map<string, WireSummaryFile['traits'][number]>,
  lang: Lang,
  level: 'all' | LevelKey,
): DrillType {
  const [n, place, top4, , lv] = ty.s
  let partner: DrillType['partner']
  if (ty.p === -2) partner = null
  else if (ty.p >= 0) {
    const t = traitByApi.get(drill.traits[ty.p])
    partner = t ? { name: pickName(lang, t), icon: t.icon } : undefined
  }
  const unitOf = (u: number) => drill.units[u]
  // レベル別の盤面が無い古いファイルは全体の盤面のまま。
  const lvb = level === 'all' || !ty.lb ? undefined : ty.lb.find((l) => l[0] === level)
  const [board, boardN, boardPlace]: [number[], number, number] =
    level === 'all' || !ty.lb ? [ty.b, ty.bs[0], ty.bs[1]] : lvb ? [lvb[1], lvb[2], lvb[3]] : [[], 0, 0]
  return {
    key: `${ty.p}|${i}`,
    partner,
    n,
    share: total > 0 ? (n / total) * 100 : 0,
    avg: place / n,
    top4: (top4 / n) * 100,
    lv: lv / n,
    board: board.map((u) => ({ name: pickName(lang, unitOf(u)), icon: unitOf(u).icon, cost: unitOf(u).cost })),
    boardN,
    boardAvg: boardN > 0 ? boardPlace / boardN : 0,
    units: ty.u.map(([u, un, s3, p3, pOther]) => {
      const info = unitOf(u)
      const other = un - s3
      return {
        api: info.api,
        name: pickName(lang, info),
        icon: info.icon,
        cost: info.cost,
        share: (un / n) * 100,
        n: un,
        star3: (s3 / un) * 100,
        star3Avg: s3 > 0 ? p3 / s3 : null,
        otherAvg: other > 0 ? pOther / other : null,
      }
    }),
  }
}
