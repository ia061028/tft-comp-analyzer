// 統計ページの掘り下げ（drill-<ビュー>.json）。特性の行を押したときに、そのビューの分だけ読む。
import type { LevelKey, WireDrillFile, WireDrillLevelsFile, WireDrillType, WireSummaryFile } from '../../shared/types'
import { pickName, type Lang } from './i18n'
import { levelBucketOf, type TraitSplit } from './summary'

/** drill-<key>.json が無い（まだ集計が回っていない）ときは null。 */
export async function loadDrill(key: string): Promise<WireDrillFile | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/drill-${key}.json`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`drill-${key}.json fetch failed (${res.status} ${res.statusText})`)
  return (await res.json()) as WireDrillFile
}

/** drill-<key>-lv.json（型のレベル区分の内訳）。無ければ null（古い集計）。 */
export async function loadDrillLevels(key: string): Promise<WireDrillLevelsFile | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/drill-${key}-lv.json`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`drill-${key}-lv.json fetch failed (${res.status} ${res.statusText})`)
  return (await res.json()) as WireDrillLevelsFile
}

/**
 * 本体の型にレベル区分の内訳（l）を付ける。2つのファイルの集計回が違う（並びが合わない）ときは付けない
 * （別の回の内訳を付けると、駒の idx や型を取り違える）。
 */
export function withDrillLevels(drill: WireDrillFile, levels: WireDrillLevelsFile): WireDrillFile {
  if (levels.generatedAt !== drill.generatedAt || levels.rows.length !== drill.rows.length) return drill
  const ok = drill.rows.every((r, i) => {
    const lr = levels.rows[i]
    return lr.t === r.t && lr.m === r.m && r.sp.every((types, k) => lr.sp[k].length === types.length)
  })
  if (!ok) return drill
  return {
    ...drill,
    rows: drill.rows.map((r, i) => ({
      ...r,
      sp: r.sp.map((types, k) => types.map((ty, j) => ({ ...ty, l: levels.rows[i].sp[k][j] }))) as typeof r.sp,
    })),
  }
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

/** レベル区分ごとの内訳（l）を持つファイルか。古いファイルは型の数字が全レベルの分。 */
export function drillHasLevels(drill: WireDrillFile): boolean {
  return drill.rows.some((r) => r.sp.some((types) => types.some((ty) => ty.l)))
}

/**
 * 特性の段（summary.json の行キー）の型一覧。人数の多い順（まとめ行は最後）。
 * 相方特性は api で summary.json の特性に引き当てる（ファイル間で並びがずれても名前を取り違えない）。
 * レベルを選んでいるときは、型ごとにそのレベルのプレイヤーの内訳（l）を出す。人数・平均・駒・最多の盤面が
 * 全部同じプレイヤーの分になる（盤面だけレベル別だと、駒の採用率に別レベルの人が混ざって盤面と食い違う）。
 * 内訳の無い古いファイルは、型を平均Lvでふるい分け、盤面だけレベル別（bl）にする。
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
  const traitByApi = new Map(summary.traits.map((t) => [t.api, t]))
  const types = row.sp[SPLIT_COL[split]]
  if (level !== 'all' && drillHasLevels(drill)) {
    const slices = types
      .map((ty, i) => {
        const sl = ty.l?.find((l) => l.k === level)
        return sl ? { ty: { ...ty, ...sl, l: undefined, bl: undefined }, i } : null
      })
      .filter((x) => x !== null)
      .sort((a, b) => (a.ty.p === -2 ? 1 : 0) - (b.ty.p === -2 ? 1 : 0) || b.ty.s[0] - a.ty.s[0] || a.i - b.i)
    const total = slices.reduce((s, x) => s + x.ty.s[0], 0)
    return slices.map(({ ty, i }) => toType(ty, i, total, drill, traitByApi, lang, 'all'))
  }
  const total = types.reduce((s, ty) => s + ty.s[0], 0)
  return types
    .map((ty, i) => toType(ty, i, total, drill, traitByApi, lang, level))
    .filter((ty) => level === 'all' || levelBucketOf(ty.lv) === level)
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
  // レベル別の盤面が無い古いファイルは、全員の最多の盤面を出す。
  let [board, boardN, boardPlace] = [ty.b, ty.bs[0], ty.bs[1]]
  if (level !== 'all' && ty.bl) {
    const hit = ty.bl.find((l) => l[0] === level)
    ;[board, boardN, boardPlace] = hit ? [hit[1], hit[2], hit[3]] : [[], 0, 0]
  }
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
