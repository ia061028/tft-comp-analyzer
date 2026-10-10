/// <reference lib="webworker" />
import { bestBoard, buildRoute, maxCostAt, type LadderData, type LadderBoard, type RouteStep } from './ladder'

/**
 * 特性ラダーの探索をメインスレッドの外で回す。ルート1本で数百ミリ秒かかるので、
 * そのままだと入力のたびに画面が固まる。レベルごとに出来た順で返し、画面は上から埋まる。
 */
export interface LadderRequest {
  id: number
  data: LadderData
  levels: number[]
  bonus: number
  emblems: number[]
  allowFive: boolean
  locked: number[]
  excluded: number[]
  /** 選択式の付与を数えない駒（units の idx）。 */
  choosersOff: number[]
  /** 紋章の判定に使うレベル（このレベルで紋章あり／なしを比べる）。 */
  judgeLevel: number
}

/** Map は postMessage で渡せるが、型を素直にするため配列に直して返す。 */
export type WireBoard = Omit<LadderBoard, 'counts' | 'choices'> & {
  counts: [number, number][]
  choices: [number, number][]
}
export type WireStep = Omit<RouteStep, 'board'> & { board: WireBoard }

export type LadderResponse =
  | { id: number; kind: 'step'; step: WireStep }
  | { id: number; kind: 'emblem'; emblem: number; gain: number }
  | { id: number; kind: 'done' }

const wire = (b: LadderBoard): WireBoard => ({ ...b, counts: [...b.counts], choices: [...b.choices] })

/** 同じ入力の結果は覚えておく（紋章を付けたり外したりして戻ったときは計算しない）。 */
const cache = new Map<string, LadderResponse[]>()
const CACHE_MAX = 64

self.onmessage = (e: MessageEvent<LadderRequest>) => {
  const req = e.data
  const post = (r: LadderResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r)
  const key = JSON.stringify([
    req.levels,
    req.bonus,
    req.emblems,
    req.allowFive,
    req.locked,
    req.excluded,
    req.choosersOff,
    req.judgeLevel,
  ])
  const hit = cache.get(key)
  if (hit) {
    for (const r of hit) post({ ...r, id: req.id })
    return
  }
  const out: LadderResponse[] = []
  const send = (r: LadderResponse) => {
    out.push(r)
    post(r)
  }
  const common = {
    emblems: req.emblems,
    allowFive: req.allowFive,
    locked: req.locked,
    excluded: req.excluded,
    choosersOff: req.choosersOff,
  }
  // ルートはレベルが1つ決まるたびに返す（画面は上から埋まる）。
  buildRoute(req.data, { ...common, levels: req.levels, bonus: req.bonus }, (step) =>
    send({ id: req.id, kind: 'step', step: { ...step, board: wire(step.board) } }),
  )
  // 紋章ごとに「判定レベルで、その紋章を外すと何種類減るか」。全部持った盤面は1回だけ求める。
  if (req.emblems.length > 0) {
    const judge = {
      allowFive: req.allowFive,
      locked: req.locked,
      excluded: req.excluded,
      choosersOff: req.choosersOff,
      size: req.judgeLevel + req.bonus,
      maxCost: maxCostAt(req.judgeLevel, req.allowFive),
    }
    const withAll = bestBoard(req.data, { ...judge, emblems: req.emblems }).active
    for (const emblem of new Set(req.emblems)) {
      const others = [...req.emblems]
      others.splice(others.indexOf(emblem), 1)
      const without = bestBoard(req.data, { ...judge, emblems: others }).active
      send({ id: req.id, kind: 'emblem', emblem, gain: Math.max(0, withAll - without) })
    }
  }
  send({ id: req.id, kind: 'done' })
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, out)
}
