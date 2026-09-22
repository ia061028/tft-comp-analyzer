// aggregate.ts の集計ロジック本体を純関数として分離したモジュール。
// ここには fs / fetch / process / console への依存を持ち込まない（テスト可能に保つ）。

import type { StaticData } from './cdragon.ts'
import type {
  ParticipantRecord,
  WireStatsFile,
  WireComp,
  TraitInfo,
  EmblemInfo,
  UnitInfo,
  ItemInfo,
  TraitGranter,
} from '../shared/types.ts'

// 召喚・非ショップユニット（apiName が _Summon で終わる／Minion・PVE・Enemy_・TrainingDummy を含む）は
// 導き手等で盤面にレベル+1で出現するため構成ユニットから除外（レベルと整合）。
// 命名規約に依存するためセット固有の実体は書かない。新セットでは診断の未解決ユニット警告と
// 盤面ユニット数で取りこぼしを確認すること。
export const NON_BOARD_UNIT_RE = /_Summon$|Minion|PVE|Enemy_|TrainingDummy/

// 集計定数。
/** 出力対象とする構成の総レコード数の下限。 */
export const MIN_OUTPUT_N = 3
/** 推奨アイテムを収集する上位ユニット数（保持総数順）。 */
export const CARRY_UNITS = 4
/** ユニットごとに表示する推奨アイテム数。 */
export const ITEMS_PER_UNIT = 3
/** 紋章ごとに表示する装備者数。 */
export const HOLDERS_PER_EMBLEM = 3
/** 装備者採用の最小シェア（先頭は無条件採用）。 */
export const HOLDER_MIN_SHARE = 0.2
/** 上乗せ特性を構成に載せる最小シェア。これ未満は「たまたまその選択だった」ノイズ。 */
export const GRANT_MIN_SHARE = 0.15
/** 1構成あたりに出力する上乗せ特性の上限（ファイルサイズの歯止め）。 */
export const GRANTS_PER_COMP = 8
/**
 * 付与元ユニットと認めるカバレッジ下限。
 * 「トレイト t の上乗せが観測されたレコードのうち、ユニット u が盤面に居た割合」。
 * 1トレイトを複数ユニットが付与するセットではどのユニットも閾値に届かず、
 * 付与元なし（＝数は正しいが誰の分か出さない）に自然に縮退する。
 */
export const GRANTER_MIN_COVERAGE = 0.9
/** 追加盤面枠の上限（レベルとユニット数のズレはノイズも含むのでクランプする）。 */
export const MAX_SLOT_EXTRA = 2

export interface LoadedRecord {
  rec: ParticipantRecord
  route: string
}

/** 値→件数の Map から最頻値（同数なら大きい方）。空なら undefined。 */
export function modeMaxFromCounts(counts: Map<number, number>): number | undefined {
  let best: number | undefined
  let bestCount = -1
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && best !== undefined && v > best)) {
      bestCount = c
      best = v
    }
  }
  return best
}

/** 最頻値（同数なら大きい方）。空なら undefined。 */
export function modeMaxNumber(values: number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return modeMaxFromCounts(counts)
}

/**
 * セット番号ごとの件数から集計対象のセット番号を選ぶ（最頻値・同数なら大きい方）。
 * s を持つレコードが1件も無ければ null（＝セット絞り込みをしない）。
 * 同一 game_version 内でセットが切り替わる場合にパッチ選定だけでは分離できないため、
 * tft_set_number を一次情報として使う。
 */
export function pickTargetSetFromCounts(counts: Map<number, number>): number | null {
  return modeMaxFromCounts(counts) ?? null
}

/** 配列版（テスト・小規模用）。ストリーミング集計は pickTargetSetFromCounts を使う。 */
export function pickTargetSet(records: LoadedRecord[]): number | null {
  const counts = new Map<number, number>()
  for (const lr of records) {
    if (typeof lr.rec.s === 'number') counts.set(lr.rec.s, (counts.get(lr.rec.s) ?? 0) + 1)
  }
  return pickTargetSetFromCounts(counts)
}

export interface SplitBoardResult {
  /** 盤面ユニット apiName（昇順・構成キー用）。 */
  boardApis: string[]
  /** 盤面ユニット集合（表示用収集のメンバシップ判定に使用）。 */
  boardSet: Set<string>
  /** 静的データに解決できなかったユニット apiName（診断用・重複含む）。 */
  unresolvedUnits: string[]
}

/** 盤面ユニット集合を構築する（召喚・非ショップ除外、コスト1-5、重複除去）。 */
export function splitBoardUnits(rec: ParticipantRecord, staticData: StaticData): SplitBoardResult {
  const boardSet = new Set<string>()
  const unresolvedUnits: string[] = []
  for (const uApi of rec.u) {
    const uInfo = staticData.units.get(uApi)
    if (!uInfo) {
      unresolvedUnits.push(uApi)
      continue
    }
    if (uInfo.cost < 1 || uInfo.cost > 5 || NON_BOARD_UNIT_RE.test(uApi)) continue
    boardSet.add(uApi)
  }
  return { boardApis: [...boardSet].sort(), boardSet, unresolvedUnits }
}

export interface ClassifyEmblemsResult {
  /** 活用された紋章の apiName（rec.e の並び順＝多重度を保持）。 */
  active: string[]
  /** 同上の集合。装備者収集のゲートに使う。 */
  activeEmblemApis: Set<string>
  /** 静的データに解決できなかった紋章 apiName（診断用・重複含む）。 */
  unresolvedEmblems: string[]
}

/**
 * 装備紋章のうち「活用された」ものを抽出する。
 *
 * 活用の定義は二値: 装備している AND 付与トレイト（変種含むいずれか）が発動している(tier>=1)。
 * 発動数がブレークポイントちょうどか超過か（＝余っているか）は区別しない。要件が
 * 「その紋章を使ったシナジーが1つでも発動していれば対象」であり、余りの区別は要求されていないため。
 * 同一紋章を複数装備した場合は rec.e の並びをそのまま辿ることで多重度が保たれる。
 * apiName は staticData.emblemAliases で canonical に正規化してから解決する。
 */
export function classifyEmblems(
  rec: ParticipantRecord,
  staticData: StaticData,
): ClassifyEmblemsResult {
  const active: string[] = []
  const unresolvedEmblems: string[] = []
  for (const rawApi of rec.e) {
    // 同一トレイトを付与する重複紋章は canonical に正規化してから辞書を引く。
    const eApi = staticData.emblemAliases.get(rawApi) ?? rawApi
    const emb = staticData.emblems.get(eApi)
    if (!emb) {
      unresolvedEmblems.push(rawApi)
      continue
    }
    if (emb.traitApis.some((a) => a in rec.t)) active.push(eApi)
  }
  return { active, activeEmblemApis: new Set(active), unresolvedEmblems }
}

/**
 * 静的データから期待されるトレイト発動数（トレイト apiName → ユニット数）。
 *
 * 盤面ユニットの所持トレイト ＋ 装備紋章の付与分。紋章は装備者が既に持つトレイトには
 * 装備できない（incompatibleTraits）ので、枚数ぶんそのまま +1 して良い。
 */
export function expectedTraitCounts(
  rec: ParticipantRecord,
  staticData: StaticData,
  boardSet: ReadonlySet<string>,
): Map<string, number> {
  const exp = new Map<string, number>()
  const bump = (tApi: string): void => {
    exp.set(tApi, (exp.get(tApi) ?? 0) + 1)
  }
  for (const uApi of boardSet) {
    for (const tApi of staticData.units.get(uApi)?.traits ?? []) bump(tApi)
  }
  for (const rawApi of rec.e) {
    const eApi = staticData.emblemAliases.get(rawApi) ?? rawApi
    const emb = staticData.emblems.get(eApi)
    if (emb) bump(emb.traitApi)
  }
  return exp
}

/**
 * 静的データ・紋章では説明できない特性の上乗せを逆算する（トレイト apiName → 上乗せ数）。
 *
 * セット18 では ラックス（選択特性が2体分）・カ＝ジックス（進化で最大4特性）・
 * エルダードラゴン（リフトビースト2体分）がこれに当たる。ユニット名を決め打ちせず、
 * 実レコードの num_units と期待値の差だけで拾うので、同種の機構が増えても追従する。
 *
 * **限界**: rec.tc は発動済みトレイト（tier_current>=1）しか持たないので、
 * 発動していない付与は見えない。上乗せは常に過小評価になる。
 */
export function inferTraitGrants(
  rec: ParticipantRecord,
  staticData: StaticData,
  boardSet: ReadonlySet<string>,
): Map<string, number> {
  const grants = new Map<string, number>()
  if (!rec.tc) return grants
  const exp = expectedTraitCounts(rec, staticData, boardSet)
  for (const [tApi, actual] of Object.entries(rec.tc)) {
    if (!staticData.traits.has(tApi)) continue
    const delta = actual - (exp.get(tApi) ?? 0)
    if (delta > 0) grants.set(tApi, delta)
  }
  return grants
}

/**
 * 盤面ユニット数に対する追加の盤面枠。
 * エルダードラゴンのように1体で2枠使うユニットが居ると、プレイヤーレベルより
 * 盤面ユニット数が少なくなる。レベル未記録・想定外の値は 0 に落とす。
 */
export function slotExtraOf(rec: ParticipantRecord, boardCount: number): number {
  if (!rec.lv || boardCount <= 0) return 0
  const extra = rec.lv - boardCount
  if (extra <= 0) return 0
  return Math.min(extra, MAX_SLOT_EXTRA)
}

export interface AggregateDiag {
  /** 盤面ユニットが1体も無く除外したレコード数。 */
  noBoard: number
  /** 未解決トレイトを含み除外したレコード数。 */
  excludedUnresolvedTrait: number
  /** accumulate した盤面グループ（構成キー）数。boardFilter で除外した盤面は含まない。 */
  boardGroupCount: number
  /** n は足りていたが紋章シグネチャが1つも無く、出力から外した盤面数。 */
  noSigBoards: number
  /** 未解決トレイト apiName 集合（該当レコード除外）。 */
  unresolvedTraitNames: Set<string>
  /** 未解決ユニット apiName 集合（該当ユニットのみ無視）。 */
  unresolvedUnitNames: Set<string>
  /** 未解決紋章 apiName 集合（該当紋章のみ無視）。 */
  unresolvedEmblemNames: Set<string>
}

export type RecordClass =
  | { kind: 'ok'; boardKey: string; boardApis: string[]; boardSet: Set<string>; unresolvedUnits: string[] }
  | { kind: 'unresolvedTrait'; names: string[] }
  | { kind: 'noBoard'; unresolvedUnits: string[] }

/**
 * レコードを集計上の扱いで分類する。
 * - unresolvedTrait: 未解決トレイトを含む（レコードごと除外。カバレッジ100%なら発生しない）
 * - noBoard: 盤面ユニットが1体も無い（除外）
 * - ok: 構成キー（盤面ユニット apiName 昇順を '|' 連結）付き
 */
export function classifyRecord(rec: ParticipantRecord, staticData: StaticData): RecordClass {
  const names: string[] = []
  for (const tApi of Object.keys(rec.t)) {
    if (!staticData.traits.has(tApi)) names.push(tApi)
  }
  if (names.length > 0) return { kind: 'unresolvedTrait', names }
  const { boardApis, boardSet, unresolvedUnits } = splitBoardUnits(rec, staticData)
  if (boardSet.size === 0) return { kind: 'noBoard', unresolvedUnits }
  return { kind: 'ok', boardKey: boardApis.join('|'), boardApis, boardSet, unresolvedUnits }
}

export interface StatsBuilderOptions {
  targetPatch: string
  tftPatch: string
  generatedAt: string
  /** 出力構成数の上限（n 降順、同数は盤面キー昇順で切る）。0/undefined = 無制限。 */
  maxComps?: number
  /**
   * 2パス集計用の事前フィルタ。false の盤面は totals / 除外カウントには数えるが accumulate しない
   * （最終的に n < MIN_OUTPUT_N で落ちる盤面のアキュムレータを最初から作らないため）。
   */
  boardFilter?: (boardKey: string) => boolean
}

export interface StatsBuilder {
  /** レコードを1件取り込む（同期）。 */
  add(rec: ParticipantRecord, route: string): void
  /** 集計を確定して WireStatsFile と診断を返す。 */
  finish(): { out: WireStatsFile; diag: AggregateDiag }
}

/**
 * ストリーミング集計器。add() でレコードを1件ずつ取り込み、finish() で
 * 出力整形〜インターン〜Wire 圧縮を行う。全レコードをメモリに持たない。
 * generatedAt / targetPatch / tftPatch は副作用（時刻・設定）を排除するため引数注入する。
 */
export function createStatsBuilder(staticData: StaticData, opts: StatsBuilderOptions): StatsBuilder {
  const unresolvedTraitNames = new Set<string>()
  const unresolvedUnitNames = new Set<string>()
  const unresolvedEmblemNames = new Set<string>()

  // 盤面ユニット集合でグルーピング ＋ 紋章活用シグネチャ集計。
  interface SigAcc {
    e: string[] // 活用紋章 apiName の多重集合（ソート済み）
    n: number
    top4: number
    win: number
    p: number // 順位合計
  }
  interface CompAcc {
    unitApis: string[] // 盤面ユニット apiName（ソート済み・構成キー）
    n: number
    // 表示用（スターは件数 Map。レコード数に比例して伸びる配列を持たない）
    unitStarCounts: Map<string, Map<number, number>>
    itemCounts: Map<string, Map<string, number>>
    holderCounts: Map<string, Map<string, number>>
    // 紋章活用シグネチャ
    sigs: Map<string, SigAcc>
    /** トレイト apiName → 上乗せ数 → 件数。 */
    grantCounts: Map<string, Map<number, number>>
    /** 上乗せを逆算できたレコード数（tc を持つレコード）。share の分母。 */
    grantRecords: number
    /** 追加盤面枠 → 件数。 */
    slotExtraCounts: Map<number, number>
  }

  const map = new Map<string, CompAcc>()
  // 付与元ユニットの推定用。トレイト apiName → ユニット apiName → 同時出現数。
  const granterCo = new Map<string, Map<string, number>>()
  // トレイト apiName → 上乗せが観測されたレコード数（granterCo の分母）。
  const granterTotal = new Map<string, number>()
  let noBoard = 0
  let excludedUnresolvedTrait = 0
  const byRoute: Record<string, number> = {}
  const uniqueMatches = new Set<string>()
  let participants = 0

  function add(rec: ParticipantRecord, route: string): void {
    byRoute[route] = (byRoute[route] ?? 0) + 1
    uniqueMatches.add(rec.m)
    participants++

    const cls = classifyRecord(rec, staticData)
    if (cls.kind === 'unresolvedTrait') {
      for (const n of cls.names) unresolvedTraitNames.add(n)
      excludedUnresolvedTrait++
      return
    }
    for (const u of cls.unresolvedUnits) unresolvedUnitNames.add(u)
    if (cls.kind === 'noBoard') {
      noBoard++
      return
    }
    const { boardKey, boardApis, boardSet } = cls
    if (opts.boardFilter && !opts.boardFilter(boardKey)) return

    let acc = map.get(boardKey)
    if (!acc) {
      acc = {
        unitApis: boardApis,
        n: 0,
        unitStarCounts: new Map(),
        itemCounts: new Map(),
        holderCounts: new Map(),
        sigs: new Map(),
        grantCounts: new Map(),
        grantRecords: 0,
        slotExtraCounts: new Map(),
      }
      map.set(boardKey, acc)
    }
    acc.n++

    // 追加盤面枠（エルダードラゴンのような複数枠ユニットの検出）。
    const slotExtra = slotExtraOf(rec, boardSet.size)
    acc.slotExtraCounts.set(slotExtra, (acc.slotExtraCounts.get(slotExtra) ?? 0) + 1)

    // 静的データ外の特性上乗せ（tc を持つレコードのみ）。
    if (rec.tc) {
      acc.grantRecords++
      for (const [tApi, delta] of inferTraitGrants(rec, staticData, boardSet)) {
        let dc = acc.grantCounts.get(tApi)
        if (!dc) {
          dc = new Map()
          acc.grantCounts.set(tApi, dc)
        }
        dc.set(delta, (dc.get(delta) ?? 0) + 1)

        // 付与元の推定材料: この上乗せと同時に盤面に居たユニット。
        granterTotal.set(tApi, (granterTotal.get(tApi) ?? 0) + 1)
        let co = granterCo.get(tApi)
        if (!co) {
          co = new Map()
          granterCo.set(tApi, co)
        }
        for (const uApi of boardSet) co.set(uApi, (co.get(uApi) ?? 0) + 1)
      }
    }

    // ユニット別スター・完成アイテム（盤面ユニットのみ）。
    for (let i = 0; i < rec.u.length; i++) {
      const uApi = rec.u[i]
      if (!boardSet.has(uApi)) continue
      const star = rec.us?.[i]
      if (star && star > 0) {
        let sc = acc.unitStarCounts.get(uApi)
        if (!sc) {
          sc = new Map()
          acc.unitStarCounts.set(uApi, sc)
        }
        sc.set(star, (sc.get(star) ?? 0) + 1)
      }
      const unitItemList = rec.ui?.[i]
      if (unitItemList && unitItemList.length) {
        let im = acc.itemCounts.get(uApi)
        if (!im) {
          im = new Map()
          acc.itemCounts.set(uApi, im)
        }
        for (const it of unitItemList) {
          if (staticData.items.has(it)) im.set(it, (im.get(it) ?? 0) + 1)
        }
      }
    }

    // 活用紋章（装備 AND 付与トレイト発動）。
    const { active, activeEmblemApis, unresolvedEmblems } = classifyEmblems(rec, staticData)
    for (const e of unresolvedEmblems) unresolvedEmblemNames.add(e)

    // 装備者（発動ゲート済み・インスタンス単位）。
    for (let k = 0; k < rec.e.length; k++) {
      const eApi = rec.e[k]
      if (!activeEmblemApis.has(eApi)) continue
      const holder = rec.eh?.[k]
      if (holder && staticData.units.has(holder)) {
        let hc = acc.holderCounts.get(eApi)
        if (!hc) {
          hc = new Map()
          acc.holderCounts.set(eApi, hc)
        }
        hc.set(holder, (hc.get(holder) ?? 0) + 1)
      }
    }

    if (active.length === 0) return // 活用紋章なし → シグネチャ対象外

    const emblemApis = active.slice().sort()
    const sigKey = emblemApis.join('|')
    let sig = acc.sigs.get(sigKey)
    if (!sig) {
      sig = { e: emblemApis, n: 0, top4: 0, win: 0, p: 0 }
      acc.sigs.set(sigKey, sig)
    }
    sig.n++
    if (rec.p <= 4) sig.top4++
    if (rec.p === 1) sig.win++
    sig.p += rec.p
  }

  function finish(): { out: WireStatsFile; diag: AggregateDiag } {
    /** この盤面で「紋章を活用した」レコード数（＝フロントで行になりうるレコード数）。 */
    const sigRecordsOf = (acc: CompAcc): number => {
      let total = 0
      for (const sig of acc.sigs.values()) total += sig.n
      return total
    }

    // 出力対象は「総レコード n>=MIN_OUTPUT_N」かつ「紋章シグネチャを1つ以上持つ」盤面。
    //
    // sigs が空の盤面はフロントに出しても**絶対に画面に現れない**: 構成一覧の行は
    // compRows が sigs から作るので0行になり、ティアの基準（cohortPlace）も sigs しか
    // 見ないため寄与0。実データでは出力構成の 8〜17% がこれで、上限枠とファイルサイズを
    // そのぶん無駄にしていた。
    //
    // 並べ替えのキーは盤面の総レコード数ではなく**紋章を活用したレコード数**。総レコード数で
    // 切ると、紋章を使わない人気構成が上限枠を埋め、紋章を2枚以上使う構成が集まる小さい盤面から
    // 先に落ちる（実データでは n=3〜4 の構成は 18.4% が紋章2枚以上、n>=200 では 5.5%）。
    // このツールが見せたいものと逆順に切っていたことになる。stats.json を上限 12,000 で切る
    // 実測で、紋章2枚以上の行の残存率は 86.7% → 96.8%、最小 n は 4 → 3 になる。
    // 同数は総レコード数降順 → 盤面キー昇順で決定的に決める。
    let noSigBoards = 0
    const selected: { key: string; acc: CompAcc; sigRecords: number }[] = []
    for (const [key, acc] of map) {
      if (acc.n < MIN_OUTPUT_N) continue
      if (acc.sigs.size === 0) {
        noSigBoards++
        continue
      }
      selected.push({ key, acc, sigRecords: sigRecordsOf(acc) })
    }
    selected.sort(
      (a, b) =>
        b.sigRecords - a.sigRecords ||
        b.acc.n - a.acc.n ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    const capped = opts.maxComps && opts.maxComps > 0 ? selected.slice(0, opts.maxComps) : selected

    const usedTraitApis = new Set<string>()
    const usedUnitApis = new Set<string>()
    const usedEmblemApis = new Set<string>()
    const usedItemApis = new Set<string>()

    interface PreComp {
      unitApis: string[]
      n: number
      unitStarByApi: Map<string, number>
      unitItems: [string, string, number][] // [unitApi, itemApi, count]
      holders: [string, string, number][] // [emblemApi, unitApi, count]
      sigs: SigAcc[]
      grants: [string, number, number][] // [traitApi, delta, count]
      slotExtra: number
    }

    const preComps: PreComp[] = []
    for (const { acc } of capped) {
      // 盤面ユニットと、その所持トレイトを used に追加（フロントの発動数算出に使う）。
      for (const u of acc.unitApis) {
        usedUnitApis.add(u)
        for (const tApi of staticData.units.get(u)?.traits ?? []) usedTraitApis.add(tApi)
      }

      // 代表スター。
      const unitStarByApi = new Map<string, number>()
      for (const uApi of acc.unitApis) {
        const sc = acc.unitStarCounts.get(uApi)
        const ms = sc ? modeMaxFromCounts(sc) : undefined
        if (ms) unitStarByApi.set(uApi, ms)
      }

      // 推奨アイテム（保持総数上位 CARRY_UNITS ユニット × 上位 ITEMS_PER_UNIT）。
      const unitItems: [string, string, number][] = []
      const carries = [...acc.itemCounts.entries()]
        .map(([uApi, im]) => ({ uApi, im, total: [...im.values()].reduce((s, x) => s + x, 0) }))
        .sort(
          (a, b) =>
            b.total - a.total ||
            (staticData.units.get(a.uApi)!.name < staticData.units.get(b.uApi)!.name ? -1 : 1),
        )
        .slice(0, CARRY_UNITS)
      for (const { uApi, im } of carries) {
        const topItems = [...im.entries()]
          .sort(
            (a, b) =>
              b[1] - a[1] ||
              (staticData.items.get(a[0])!.name < staticData.items.get(b[0])!.name ? -1 : 1),
          )
          .slice(0, ITEMS_PER_UNIT)
        for (const [itApi, count] of topItems) {
          unitItems.push([uApi, itApi, count])
          usedUnitApis.add(uApi)
          usedItemApis.add(itApi)
        }
      }

      // 装備者。
      const holders: [string, string, number][] = []
      for (const [emblemApi, hc] of acc.holderCounts) {
        const total = [...hc.values()].reduce((s, x) => s + x, 0)
        const sorted = [...hc.entries()].sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1]
          const na = staticData.units.get(a[0])!.name
          const nb = staticData.units.get(b[0])!.name
          return na < nb ? -1 : na > nb ? 1 : a[0] < b[0] ? -1 : 1
        })
        const picked = sorted.filter(([, c], i) => i === 0 || c / total >= HOLDER_MIN_SHARE)
        for (const [unitApi, count] of picked.slice(0, HOLDERS_PER_EMBLEM)) {
          holders.push([emblemApi, unitApi, count])
          usedUnitApis.add(unitApi)
          usedEmblemApis.add(emblemApi)
        }
      }

      // シグネチャ（紋章 idx は後でインターン）。
      const sigs = [...acc.sigs.values()]
      for (const s of sigs) for (const e of s.e) usedEmblemApis.add(e)

      // 上乗せ特性。トレイトごとに最頻の上乗せ数を1件だけ採り、シェアの高い順に並べる。
      // 「最頻」を 0 込みで採らないのは、ラックスのように選択が割れる構成でも
      // 上位の選択肢を出したいため（採用数の少ない選択は GRANT_MIN_SHARE で落ちる）。
      const grants: [string, number, number][] = []
      if (acc.grantRecords > 0) {
        for (const [tApi, dc] of acc.grantCounts) {
          const delta = modeMaxFromCounts(dc)
          if (delta === undefined) continue
          const count = dc.get(delta)!
          if (count / acc.grantRecords < GRANT_MIN_SHARE) continue
          grants.push([tApi, delta, count])
          usedTraitApis.add(tApi)
        }
        grants.sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1))
        grants.length = Math.min(grants.length, GRANTS_PER_COMP)
      }

      preComps.push({
        unitApis: acc.unitApis,
        n: acc.n,
        unitStarByApi,
        unitItems,
        holders,
        sigs,
        grants,
        slotExtra: modeMaxFromCounts(acc.slotExtraCounts) ?? 0,
      })
    }

    // emblems の traitApi 参照先も used に追加。
    for (const eApi of usedEmblemApis) {
      const emb = staticData.emblems.get(eApi)
      if (emb) usedTraitApis.add(emb.traitApi)
    }

    // インターン配列（決定的順序）。
    const traitApisSorted = [...usedTraitApis].sort((a, b) => {
      const na = staticData.traits.get(a)!.name
      const nb = staticData.traits.get(b)!.name
      return na < nb ? -1 : na > nb ? 1 : a < b ? -1 : a > b ? 1 : 0
    })
    const traitIndex = new Map<string, number>()
    const traitsOut: TraitInfo[] = traitApisSorted.map((api, i) => {
      traitIndex.set(api, i)
      const t = staticData.traits.get(api)!
      return { api, name: t.name, nameJa: t.nameJa, icon: t.icon, tiers: t.tiers }
    })

    const unitApisSorted = [...usedUnitApis].sort((a, b) => {
      const ua = staticData.units.get(a)!
      const ub = staticData.units.get(b)!
      if (ua.cost !== ub.cost) return ua.cost - ub.cost
      return ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : a < b ? -1 : a > b ? 1 : 0
    })
    const unitIndex = new Map<string, number>()
    const unitsOut: UnitInfo[] = unitApisSorted.map((api, i) => {
      unitIndex.set(api, i)
      const u = staticData.units.get(api)!
      // 所持トレイトを traitIdx へ（インターン済みのもののみ）。
      const traitIdxs = u.traits
        .map((t) => traitIndex.get(t))
        .filter((x): x is number => x !== undefined)
      return { api, name: u.name, nameJa: u.nameJa, cost: u.cost, icon: u.icon, code: u.code, traits: traitIdxs }
    })

    const emblemApisSorted = [...usedEmblemApis].sort((a, b) => {
      const ea = staticData.emblems.get(a)!
      const eb = staticData.emblems.get(b)!
      return ea.name < eb.name ? -1 : ea.name > eb.name ? 1 : a < b ? -1 : a > b ? 1 : 0
    })
    const emblemIndex = new Map<string, number>()
    const emblemsOut: EmblemInfo[] = emblemApisSorted.map((api, i) => {
      emblemIndex.set(api, i)
      const e = staticData.emblems.get(api)!
      return { api, name: e.name, nameJa: e.nameJa, trait: traitIndex.get(e.traitApi)!, icon: e.icon, base: e.base, recipe: e.recipe }
    })

    const itemApisSorted = [...usedItemApis].sort((a, b) => {
      const ia = staticData.items.get(a)!
      const ib = staticData.items.get(b)!
      return ia.name < ib.name ? -1 : ia.name > ib.name ? 1 : a < b ? -1 : a > b ? 1 : 0
    })
    const itemIndex = new Map<string, number>()
    const itemsOut: ItemInfo[] = itemApisSorted.map((api, i) => {
      itemIndex.set(api, i)
      const it = staticData.items.get(api)!
      return { api, name: it.name, nameJa: it.nameJa, icon: it.icon, recipe: it.recipe }
    })

    // PreComp → WireComp。
    function toWire(pc: PreComp): WireComp {
      const unitIdxs = pc.unitApis
        .map((api) => unitIndex.get(api)!)
        .sort((a, b) => {
          const ua = unitsOut[a]
          const ub = unitsOut[b]
          if (ua.cost !== ub.cost) return ua.cost - ub.cost
          return ua.name < ub.name ? -1 : ua.name > ub.name ? 1 : a - b
        })
      const unitStars = unitIdxs.map((idx) => pc.unitStarByApi.get(unitsOut[idx].api) ?? 0)

      const unitItems: [number, number, number][] = pc.unitItems
        .map(([unitApi, itemApi, count]): [number, number, number] => [
          unitIndex.get(unitApi)!,
          itemIndex.get(itemApi)!,
          count,
        ])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])

      const holders: [number, number, number][] = pc.holders
        .map(([emblemApi, unitApi, count]): [number, number, number] => [
          emblemIndex.get(emblemApi)!,
          unitIndex.get(unitApi)!,
          count,
        ])
        .sort((a, b) => a[0] - b[0])

      const g: [number[], number, number, number, number][] = pc.sigs
        .map((s): [number[], number, number, number, number] => [
          s.e.map((e) => emblemIndex.get(e)!).sort((x, y) => x - y),
          s.n,
          s.top4,
          s.win,
          s.p,
        ])
        .sort((a, b) => b[1] - a[1])

      const grants: [number, number, number][] = pc.grants
        .map(([traitApi, delta, count]): [number, number, number] => [
          traitIndex.get(traitApi)!,
          delta,
          count,
        ])
        .sort((a, b) => b[2] - a[2] || a[0] - b[0])

      const wire: WireComp = { u: unitIdxs, n: pc.n, g }
      if (unitStars.some((s) => s > 0)) wire.k = unitStars
      if (unitItems.length) wire.i = unitItems
      if (holders.length) wire.h = holders
      if (grants.length) wire.x = grants
      if (pc.slotExtra > 0) wire.s = pc.slotExtra
      return wire
    }

    // preComps は既に紋章活用レコード数の降順（同数は総レコード数 → 盤面キー）。
    // フロントは一覧を自前で並べ替えるので、この順序は決定性のためだけのもの。
    const comps: WireComp[] = preComps.map(toWire)

    // 付与元ユニットの推定。トレイトごとにカバレッジ最大のユニットを1体だけ採る。
    // 実データ（セット18）ではカ＝ジックス・ラックス・エルダードラゴンがそれぞれ
    // 別のトレイトを付与するので1対1に決まる。決まらないセットでは閾値に届かず空になる。
    const granters: TraitGranter[] = []
    for (const [tApi, co] of granterCo) {
      const ti = traitIndex.get(tApi)
      if (ti === undefined) continue
      const total = granterTotal.get(tApi) ?? 0
      if (total === 0) continue
      let bestApi: string | undefined
      let bestCo = -1
      for (const [uApi, c] of co) {
        if (c > bestCo || (c === bestCo && bestApi !== undefined && uApi < bestApi)) {
          bestCo = c
          bestApi = uApi
        }
      }
      if (bestApi === undefined || bestCo / total < GRANTER_MIN_COVERAGE) continue
      const ui = unitIndex.get(bestApi)
      if (ui === undefined) continue
      granters.push([ui, ti])
    }
    granters.sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const out: WireStatsFile = {
      schemaVersion: 5,
      generatedAt: opts.generatedAt,
      patch: opts.targetPatch,
      tftPatch: opts.tftPatch,
      setNumber: staticData.setNumber,
      totals: {
        matches: uniqueMatches.size,
        participants,
        byRoute,
      },
      traits: traitsOut,
      emblems: emblemsOut,
      units: unitsOut,
      items: itemsOut,
      comps,
      granters,
      baseItemIcons: staticData.baseItemIcons,
    }

    const diag: AggregateDiag = {
      noBoard,
      excludedUnresolvedTrait,
      boardGroupCount: map.size,
      noSigBoards,
      unresolvedTraitNames,
      unresolvedUnitNames,
      unresolvedEmblemNames,
    }

    return { out, diag }
  }

  return { add, finish }
}

/**
 * 配列版の集計（テスト・小規模用）。createStatsBuilder を配列で回す薄いラッパ。
 */
export function buildStats(
  target: LoadedRecord[],
  staticData: StaticData,
  opts: StatsBuilderOptions,
): { out: WireStatsFile; diag: AggregateDiag } {
  const builder = createStatsBuilder(staticData, opts)
  for (const lr of target) builder.add(lr.rec, lr.route)
  return builder.finish()
}
