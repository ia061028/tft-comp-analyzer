import type { CompStats, UnitInfo } from '../../shared/types'
import { pickName, type Lang } from './i18n'

/** レール／ドックに出している選択面。紋章とチャンピオンは同じ場所を切り替えて使う。 */
export type PickTab = 'emblem' | 'unit'

/**
 * チャンピオンの絞り込み状態。`use` はその駒が盤面に居る構成だけを残し、
 * `avoid` はその駒が居る構成を外す。印の無い駒は何も絞らない。
 */
export type UnitMark = 'use' | 'avoid'

/**
 * 印は units 配列のインデックスではなく apiName で持つ。
 * units の intern はファイルごとに「生き残った構成に出た駒」だけなので、パッチを切り替えると
 * 同じ駒でもインデックスが変わりうる。
 */
export type UnitMarks = ReadonlyMap<string, UnitMark>

/** タイルを押すたびに 印なし → 使う → 使わない → 印なし と回す。 */
export function nextMark(mark: UnitMark | undefined): UnitMark | undefined {
  if (mark === undefined) return 'use'
  if (mark === 'use') return 'avoid'
  return undefined
}

/**
 * 盤面ユニットで構成を絞る。`use` の駒が全員居て、`avoid` の駒が誰も居ない構成だけを返す。
 *
 * このファイルに居ない駒の印は無視する（パッチを切り替えた直後に前のファイルの印が残っても、
 * 見えないタイルのせいで一覧が空になるのを避ける）。
 */
export function filterByUnits(
  comps: CompStats[],
  units: readonly { api: string }[],
  marks: UnitMarks,
): CompStats[] {
  if (marks.size === 0) return comps
  const use: number[] = []
  const avoid: number[] = []
  units.forEach((u, i) => {
    const mark = marks.get(u.api)
    if (mark === 'use') use.push(i)
    else if (mark === 'avoid') avoid.push(i)
  })
  if (use.length === 0 && avoid.length === 0) return comps
  return comps.filter((c) => {
    for (const u of use) if (!c.units.includes(u)) return false
    for (const u of avoid) if (c.units.includes(u)) return false
    return true
  })
}

/** 印を1つ進めた新しい Map を返す（state 用。元の Map は変えない）。 */
export function cycleMark(marks: UnitMarks, api: string): Map<string, UnitMark> {
  const next = new Map(marks)
  const mark = nextMark(marks.get(api))
  if (mark === undefined) next.delete(api)
  else next.set(api, mark)
  return next
}

/** コストごとの段（コスト昇順、段の中は表示名順）。空の段は返さない。 */
export function unitsByCost(units: UnitInfo[], lang: Lang): UnitInfo[][] {
  const rows = new Map<number, UnitInfo[]>()
  for (const u of units) {
    const row = rows.get(u.cost) ?? []
    row.push(u)
    rows.set(u.cost, row)
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.sort((a, b) => pickName(lang, a).localeCompare(pickName(lang, b), lang)))
}
