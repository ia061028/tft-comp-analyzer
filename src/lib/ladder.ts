import type { TraitGranter, TraitInfo, UnitInfo } from '../../shared/types'

/**
 * 特性ラダー（セット18のオーグメント）の計算機。
 *
 * ラダーは「発動している特性の種類数」で段が進む。11段の報酬がチームサイズ+1なので、
 * 実戦では「各レベルの体数で、何種類の特性を発動できる盤面にするか」が判断のすべてになる。
 *
 * 盤面は駒名を書かずに、辞書（駒の特性・特性の段・付与元の推定）から探索で求める。
 * セットが変われば辞書が変わるだけで、ここは書き換えない（trait-grant-inference と同じ方針）。
 */

export interface LadderData {
  units: UnitInfo[]
  traits: TraitInfo[]
  granters: TraitGranter[]
}

export interface LadderOptions {
  /** 盤面の枠数（＝レベル。チームサイズ+1 を持っていれば +1）。 */
  size: number
  /** 手持ちの紋章（traits の idx の多重集合）。 */
  emblems: number[]
  /** 5コストを候補に入れるか。 */
  allowFive: boolean
  /** 必ず入れる駒（units の idx）。枠より多いときは先頭から枠数ぶん。 */
  locked?: number[]
  /** 使わない駒（units の idx）。 */
  excluded?: number[]
  /** 直前のレベルの盤面。同じ種類数なら、こちらとの重なりが大きい盤面を選ぶ。 */
  prev?: number[]
  /** 候補にする駒のコスト上限（既定は allowFive に従い 5 か 4）。 */
  maxCost?: number
  /** 選択式の付与（カ＝ジックスの進化など）を数えるか。既定 true。 */
  useChoices?: boolean
}

export interface LadderBoard {
  units: number[]
  /** 発動している特性の種類数。 */
  active: number
  /** trait idx → 体数（紋章・付与込み）。 */
  counts: Map<number, number>
  /** 選択式の付与元（カ＝ジックスの進化など）が選んだ特性。unit idx → trait idx。 */
  choices: Map<number, number>
  /** 紋章のうち盤面で数えられたもの（持たせる駒が居ないと数えない）。 */
  emblemsUsed: number[]
  /** あと1体で発動する特性の数（同じ種類数なら多い方が先へ伸びる）。 */
  near: number
  cost: number
}

/** 段の最小体数。 */
function minUnits(tr: TraitInfo | undefined): number {
  return tr && tr.tiers.length > 0 ? tr.tiers[0][0] : Infinity
}

/**
 * 付与元を「固定」と「選択式」に分ける。
 *
 * 1つの駒に候補が2つ以上あるもの（カ＝ジックスの進化、ラックスの選択）はプレイヤーが選ぶので選択式。
 * 1つだけのもの（エルダードラゴンのリフトビースト）は常に乗る。
 */
export function splitGranters(granters: TraitGranter[]): {
  fixed: Map<number, [number, number][]>
  choice: Map<number, [number, number][]>
} {
  const byUnit = new Map<number, [number, number][]>()
  for (const g of granters) {
    const [unit, trait] = g
    const delta = g.length >= 3 ? (g as [number, number, number])[2] : 1
    const list = byUnit.get(unit) ?? []
    list.push([trait, delta])
    byUnit.set(unit, list)
  }
  const fixed = new Map<number, [number, number][]>()
  const choice = new Map<number, [number, number][]>()
  for (const [unit, list] of byUnit) (list.length >= 2 ? choice : fixed).set(unit, list)
  return { fixed, choice }
}

/** 探索の候補になる駒。チームプランナーに無い駒（ラックスの変種など）は盤面に置けないので外す。 */
export function candidateUnits(units: UnitInfo[], allowFive: boolean): number[] {
  const out: number[] = []
  units.forEach((u, i) => {
    if (u.code <= 0) return
    if (!allowFive && u.cost >= 5) return
    out.push(i)
  })
  return out
}

/**
 * 探索で使う前計算。evaluateBoard を何十万回も呼ぶので、付与元の分類や
 * 段の最小体数は1回だけ作っておく。
 */
interface Ctx {
  data: LadderData
  fixed: Map<number, [number, number][]>
  choice: Map<number, [number, number][]>
  min: number[]
}

function makeCtx(data: LadderData): Ctx {
  const { fixed, choice } = splitGranters(data.granters)
  return { data, fixed, choice, min: data.traits.map((t) => minUnits(t)) }
}

const ctxCache = new WeakMap<LadderData, Ctx>()
function ctxOf(data: LadderData): Ctx {
  let c = ctxCache.get(data)
  if (!c) ctxCache.set(data, (c = makeCtx(data)))
  return c
}

/**
 * 盤面を評価する。選択式の付与は、発動数が最大になる組を総当たりで選ぶ（候補は高々数十通り）。
 * useChoices が false なら選択式の付与は数えない（カ＝ジックスがまだ進化していない段階）。
 */
export function evaluateBoard(board: number[], data: LadderData, emblems: number[], useChoices = true): LadderBoard {
  const ctx = ctxOf(data)
  const { units } = data
  const T = data.traits.length
  const base = new Int16Array(T)
  let cost = 0
  for (const idx of board) {
    const u = units[idx]
    if (!u) continue
    cost += u.cost
    for (const t of u.traits) base[t]++
    for (const [t, d] of ctx.fixed.get(idx) ?? []) base[t] += d
  }
  // 紋章は、その特性を持たない駒に持たせて初めて数える。1体に1枚まで。
  const emblemsUsed: number[] = []
  const taken = new Set<number>()
  for (const t of emblems) {
    const h = board.findIndex((idx, i) => !taken.has(i) && !(units[idx]?.traits ?? []).includes(t))
    if (h === -1) continue
    taken.add(h)
    emblemsUsed.push(t)
    base[t]++
  }

  const choosers = useChoices ? board.filter((idx) => ctx.choice.has(idx)) : []
  let bestCounts = base
  let bestPicks = new Map<number, number>()
  let bestActive = -1
  let bestNear = -1
  const score = (c: Int16Array) => {
    let active = 0
    let near = 0
    for (let t = 0; t < T; t++) {
      const n = c[t]
      if (n <= 0) continue
      const m = ctx.min[t]
      if (n >= m) active++
      else if (n === m - 1) near++
    }
    return [active, near] as const
  }
  const walk = (i: number, c: Int16Array, picks: Map<number, number>) => {
    if (i === choosers.length) {
      const [active, near] = score(c)
      if (active > bestActive || (active === bestActive && near > bestNear)) {
        bestActive = active
        bestNear = near
        bestCounts = c.slice()
        bestPicks = new Map(picks)
      }
      return
    }
    const unit = choosers[i]
    for (const [t, d] of ctx.choice.get(unit)!) {
      c[t] += d
      picks.set(unit, t)
      walk(i + 1, c, picks)
      c[t] -= d
      picks.delete(unit)
    }
  }
  walk(0, base.slice(), new Map())
  const counts = new Map<number, number>()
  bestCounts.forEach((n, t) => {
    if (n > 0) counts.set(t, n)
  })
  return { units: [...board], active: bestActive, counts, choices: bestPicks, emblemsUsed, near: bestNear, cost }
}

/**
 * 探索中の盤面。評価用の配列だけを持ち、LadderBoard（Map 付き）は最後に1回だけ作る。
 * 探索は1盤面あたり数万回の評価をするので、ここで Map を作ると遅すぎる（実測 3倍）。
 */
interface Node {
  units: number[]
  /** 特性ごとの体数（固定の付与込み、紋章・選択式は含まない）。 */
  counts: Int16Array
  /** 特性ごとの「その特性を元から持つ駒」の数（紋章を持たせられるかの判定用）。 */
  raw: Int16Array
  cost: number
  active: number
  near: number
  ov: number
}

/**
 * 種類数と「あと1体」の数。紋章は持たせる駒が居る限り足し、選択式の付与は駒ごとに
 * 一番得な特性を選ぶ（駒どうしの干渉は無視する。最後に evaluateBoard で厳密に数え直す）。
 */
function quickScore(ctx: Ctx, n: Pick<Node, 'units' | 'counts' | 'raw'>, emblems: number[], useChoices: boolean): [number, number] {
  const c = n.counts.slice()
  const placed = new Map<number, number>()
  let holdersLeft = n.units.length
  for (const t of emblems) {
    const k = placed.get(t) ?? 0
    if (holdersLeft <= 0 || n.units.length - n.raw[t] <= k) continue
    placed.set(t, k + 1)
    holdersLeft--
    c[t]++
  }
  if (useChoices) {
    for (const u of n.units) {
      const opts = ctx.choice.get(u)
      if (!opts) continue
      let bestT = -1
      let bestD = 0
      let bestGain = -1
      for (const [t, d] of opts) {
        const m = ctx.min[t]
        const before = c[t] >= m ? 2 : c[t] === m - 1 ? 1 : 0
        const after = c[t] + d >= m ? 2 : c[t] + d === m - 1 ? 1 : 0
        const gain = after - before
        if (gain > bestGain) {
          bestGain = gain
          bestT = t
          bestD = d
        }
      }
      if (bestT >= 0) c[bestT] += bestD
    }
  }
  let active = 0
  let near = 0
  for (let t = 0; t < c.length; t++) {
    const v = c[t]
    if (v <= 0) continue
    const m = ctx.min[t]
    if (v >= m) active++
    else if (v === m - 1) near++
  }
  return [active, near]
}

/**
 * 並べ方: 種類数 → 直前の盤面との重なり → あと1体の特性 → コストの安さ。
 * 重なりを種類数の次に置くのは、ゲーム中は「今の盤面から何を足すか」で動くため。
 * 種類数が同じなら、駒を入れ替えなくて済む盤面の方が実行しやすい。
 */
function better(a: Node, b: Node): number {
  return b.active - a.active || b.ov - a.ov || b.near - a.near || a.cost - b.cost
}

const BEAM = 120

/**
 * 枠数ぶんの駒で、発動する特性の種類数が最大になる盤面を探す。
 *
 * 1体ずつ足すビームサーチ（各段で上位 BEAM 件を残す）の後、1体の入れ替えで山登りする。
 * 厳密解ではないが、候補が50体前後・枠が10以下なら実用上は十分。
 */
export function bestBoard(data: LadderData, opts: LadderOptions): LadderBoard {
  const ctx = ctxOf(data)
  const T = data.traits.length
  const excluded = new Set(opts.excluded ?? [])
  const maxCost = opts.maxCost ?? (opts.allowFive ? 5 : 4)
  const pool = candidateUnits(data.units, opts.allowFive).filter(
    (i) => !excluded.has(i) && data.units[i].cost <= maxCost,
  )
  const locked = [...new Set(opts.locked ?? [])].filter((i) => data.units[i]).slice(0, opts.size)
  const lockedSet = new Set(locked)
  const free = pool.filter((i) => !lockedSet.has(i))
  const useChoices = opts.useChoices ?? true
  const prev = opts.prev ? new Set(opts.prev) : undefined

  const withUnit = (n: Pick<Node, 'units' | 'counts' | 'raw' | 'cost' | 'ov'>, u: number, sign: 1 | -1) => {
    const counts = n.counts.slice()
    const raw = n.raw.slice()
    const unit = data.units[u]
    for (const t of unit.traits) {
      counts[t] += sign
      raw[t] += sign
    }
    for (const [t, d] of ctx.fixed.get(u) ?? []) counts[t] += sign * d
    return { counts, raw, cost: n.cost + sign * unit.cost, ov: n.ov + (prev?.has(u) ? sign : 0) }
  }
  const finish = (units: number[], p: Pick<Node, 'counts' | 'raw' | 'cost' | 'ov'>): Node => {
    const [active, near] = quickScore(ctx, { units, counts: p.counts, raw: p.raw }, opts.emblems, useChoices)
    return { units, ...p, active, near }
  }

  let root: Pick<Node, 'units' | 'counts' | 'raw' | 'cost' | 'ov'> = {
    units: [],
    counts: new Int16Array(T),
    raw: new Int16Array(T),
    cost: 0,
    ov: 0,
  }
  for (const u of locked) root = { units: [...root.units, u], ...withUnit(root, u, 1) }
  let beam: Node[] = [finish(root.units, root)]
  for (let n = locked.length; n < opts.size; n++) {
    const seen = new Set<string>()
    const next: Node[] = []
    for (const st of beam) {
      const have = new Set(st.units)
      for (const c of free) {
        if (have.has(c)) continue
        const units = [...st.units, c].sort((x, y) => x - y)
        const key = units.join(',')
        if (seen.has(key)) continue
        seen.add(key)
        next.push(finish(units, withUnit(st, c, 1)))
      }
    }
    if (next.length === 0) break
    next.sort(better)
    beam = next.slice(0, BEAM)
  }

  // 山登り: 上位いくつかから、ロック外の1体を入れ替えて良くなる限り続ける。
  let best = beam[0]
  for (const start of beam.slice(0, 4)) {
    let cur = start
    for (let improved = true; improved; ) {
      improved = false
      const have = new Set(cur.units)
      for (const out of cur.units) {
        if (lockedSet.has(out)) continue
        const without = { units: cur.units, ...withUnit(cur, out, -1) }
        for (const c of free) {
          if (have.has(c)) continue
          const units = cur.units.map((x) => (x === out ? c : x)).sort((x, y) => x - y)
          const cand = finish(units, withUnit(without, c, 1))
          if (better(cand, cur) < 0) {
            cur = cand
            improved = true
            break
          }
        }
        if (improved) break
      }
    }
    if (better(cur, best) < 0) best = cur
  }
  return evaluateBoard(best.units, data, opts.emblems, useChoices)
}

export interface RouteStep {
  level: number
  board: LadderBoard
  /** 直前のレベルから足す駒・外す駒。 */
  added: number[]
  removed: number[]
}

/**
 * レベルごとに候補にするコストの上限。ショップの出現率に合わせる。
 * Lv5 までは4コストがほぼ出ない。Lv6・7 の4コストはドラフトで取る前提（解説の定型も Lv6 で4コストを2体使う）。
 * 5コストは Lv8 から、しかも選んだときだけ。
 */
export function maxCostAt(level: number, allowFive: boolean): number {
  if (level <= 5) return 3
  if (level <= 7) return 4
  return allowFive ? 5 : 4
}

/**
 * 選択式の付与（カ＝ジックスの進化）を数え始めるレベル。進化にはテイクダウンが要るので、
 * 解説どおり Lv7 から1回ぶんを数える。
 */
export const CHOICE_FROM_LEVEL = 7

/**
 * レベルごとの盤面を順に求める（ルート表）。各レベルは直前の盤面との重なりを優先するので、
 * 上から順に「足す駒」を読めばそのまま試合の進め方になる。
 */
export function buildRoute(
  data: LadderData,
  opts: Omit<LadderOptions, 'size' | 'prev' | 'maxCost' | 'useChoices'> & {
    levels: number[]
    bonus: number
    /** levels の手前のレベルの盤面（1レベルずつ求めるときに渡す）。 */
    prevBoard?: number[]
  },
): RouteStep[] {
  const out: RouteStep[] = []
  let prev: number[] | undefined = opts.prevBoard
  for (const level of opts.levels) {
    const board = bestBoard(data, {
      ...opts,
      size: level + opts.bonus,
      prev,
      maxCost: maxCostAt(level, opts.allowFive),
      useChoices: level >= CHOICE_FROM_LEVEL,
    })
    const p = new Set(prev ?? [])
    const now = new Set(board.units)
    out.push({
      level,
      board,
      added: board.units.filter((u) => !p.has(u)),
      removed: [...p].filter((u) => !now.has(u)),
    })
    prev = board.units
  }
  return out
}

/** 紋章の判定。使うと何種類増えるか（0 なら再合成を勧める）。 */
export function emblemGain(data: LadderData, opts: Omit<LadderOptions, 'emblems'>, emblem: number, others: number[] = []) {
  const withIt = bestBoard(data, { ...opts, emblems: [...others, emblem] })
  const without = bestBoard(data, { ...opts, emblems: others })
  return { gain: withIt.active - without.active, withIt, without }
}

/**
 * 選択式の付与元（カ＝ジックス）の選択肢ごとの種類数。盤面は固定して、選ぶ特性だけを変える。
 * 多い順。同数なら元の並び。
 */
export function choiceRanking(board: LadderBoard, unit: number, data: LadderData, emblems: number[]): { trait: number; active: number }[] {
  const { choice } = splitGranters(data.granters)
  const opts = choice.get(unit)
  if (!opts || !board.units.includes(unit)) return []
  const forced: TraitGranter[] = data.granters.filter((g) => g[0] !== unit)
  return opts
    .map(([t, d]) => {
      // その特性だけを固定の付与として評価し直す。
      const ev = evaluateBoard(board.units, { ...data, granters: [...forced, [unit, t, d]] }, emblems)
      return { trait: t, active: ev.active }
    })
    .sort((a, b) => b.active - a.active)
}

/**
 * 段ごとの報酬（特性ラダーの報酬表）。ゲームデータの API には無いので、解説の表をそのまま持つ。
 * 確率で分かれる段は「/」で並べる。
 */
export const LADDER_REWARDS: Record<number, { ja: string; en: string }> = {
  2: { ja: '1ゴールド・再合成装置', en: '1 gold, Reforger' },
  3: { ja: '3ゴールド', en: '3 gold' },
  4: { ja: '6ゴールド', en: '6 gold' },
  5: { ja: 'ランダムなアイテム素材', en: 'Random component' },
  6: { ja: '10ゴールド / 3コスト3体', en: '10 gold / three 3-costs' },
  7: { ja: '素材アイテムの金床・8ゴールド', en: 'Component anvil, 8 gold' },
  8: { ja: '完成アイテムの金床 / 素材2つ・再合成装置', en: 'Completed anvil / 2 components, Reforger' },
  9: { ja: '5コスト3体・2ゴールド', en: 'Three 5-costs, 2 gold' },
  10: { ja: '20ゴールド', en: '20 gold' },
  11: { ja: 'タクティシャンの盾・王冠・ケープ（チームサイズ+1）', en: "Tactician's item (team size +1)" },
  12: { ja: '幸運のアイテムチェスト・4コスト3体', en: 'Lucky item chest, three 4-costs' },
  13: { ja: '8ゴールド・アイテム除去装置・素材4つ', en: '8 gold, Remover, 4 components' },
  14: { ja: 'マスターワークアップグレード・10ゴールド', en: 'Masterwork upgrade, 10 gold' },
}

/** チームサイズ+1 をくれる段。 */
export const TEAM_SIZE_STEP = 11
