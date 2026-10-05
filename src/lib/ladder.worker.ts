/// <reference lib="webworker" />
import { buildRoute, emblemGain, maxCostAt, type LadderData, type LadderBoard, type RouteStep } from './ladder'

/**
 * 特性ラダーの探索をメインスレッドの外で回す。ルート1本で 1 秒前後かかるので、
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

let latest = 0

/** 次のメッセージ（新しい依頼）を受け取れるよう、いったん手放す。 */
const yieldNow = () => new Promise((r) => setTimeout(r, 0))

self.onmessage = async (e: MessageEvent<LadderRequest>) => {
  const req = e.data
  latest = req.id
  const post = (r: LadderResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r)
  const common = { emblems: req.emblems, allowFive: req.allowFive, locked: req.locked, excluded: req.excluded }
  // レベルを1つずつ求めて返す。レベルの合間に手放すので、入力が変わって新しい依頼が来たら
  // latest が進み、古い依頼はそこで打ち切られる。
  let prev: number[] | undefined
  for (const level of req.levels) {
    await yieldNow()
    if (latest !== req.id) return
    const [step] = buildRoute(req.data, { ...common, levels: [level], bonus: req.bonus, prevBoard: prev })
    prev = step.board.units
    post({ id: req.id, kind: 'step', step: { ...step, board: wire(step.board) } })
  }
  // 紋章ごとに「判定レベルで、その紋章を外すと何種類減るか」。
  for (const emblem of new Set(req.emblems)) {
    await yieldNow()
    if (latest !== req.id) return
    const others = [...req.emblems]
    others.splice(others.indexOf(emblem), 1)
    const { emblems: _all, ...rest } = common
    void _all
    const { gain } = emblemGain(
      req.data,
      { ...rest, size: req.judgeLevel + req.bonus, maxCost: maxCostAt(req.judgeLevel, req.allowFive) },
      emblem,
      others,
    )
    post({ id: req.id, kind: 'emblem', emblem, gain })
  }
  post({ id: req.id, kind: 'done' })
}
