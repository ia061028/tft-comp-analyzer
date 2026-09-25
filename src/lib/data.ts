import type {
  StatsFile,
  WireStatsFile,
  WireComp,
  CompStats,
  EmblemSig,
  PatchIndexEntry,
  TraitGrant,
} from '../../shared/types'
import { StatsStreamParser } from './statsStream'
import { t, type Lang } from './i18n'

/** フロントが最初に読む既定ビューのファイル名（集計側の既定パッチ）。 */
export const DEFAULT_STATS_FILE = 'stats.json'

/** 全パッチ合算ビューの選択キー（集計側 ALL_PATCHES_KEY と対応）。 */
export const ALL_PATCHES_KEY = 'all'

/** 直近 N 日ビューの選択キー（集計側 recentViewKey と対応）。 */
const RECENT_KEY_RE = /^recent(\d+)d$/

/** パッチ切り替えに出すビュー名。「全体」と「直近N日」はキーから言語ごとに作る。 */
export function viewOptionLabel(lang: Lang, key: string, label: string): string {
  if (key === ALL_PATCHES_KEY) return t(lang, 'all')
  const m = key.match(RECENT_KEY_RE)
  return m ? t(lang, 'recentDays', { n: Number(m[1]) }) : label
}

/**
 * [先頭, 値...] の塊を [先頭, 値] の組へ開く（schemaVersion 8 の i / h）。
 * 7 以前は [先頭, 値, 回数] の組なので、回数だけ落とす。
 */
function pairs(groups: number[][] | undefined, legacy: boolean): [number, number][] {
  const out: [number, number][] = []
  for (const g of groups ?? []) {
    if (legacy) out.push([g[0], g[1]])
    else for (let j = 1; j < g.length; j++) out.push([g[0], g[j]])
  }
  return out
}

function decodeComp(c: WireComp, legacy: boolean): CompStats {
  const sigs: EmblemSig[] = c.g.map(([e, n, top4, win, p]) => ({ e, n, top4, win, p }))
  // share の分母は「上乗せを逆算できたレコード数」だが、オンディスクでは持たない。
  // 逆算できないのは tc を持たない旧レコードだけで実データでは 1% 未満なので、
  // 構成の総レコード数で割る（share がわずかに小さめに出るだけで順序は変わらない）。
  const grants: TraitGrant[] = (c.x ?? []).map(([trait, delta, n]) => ({
    trait,
    delta,
    n,
    share: c.n > 0 ? n / c.n : 0,
  }))
  return {
    units: c.u,
    n: c.n,
    unitStars: c.k ?? c.u.map(() => 0),
    unitItems: pairs(c.i, legacy),
    holders: pairs(c.h, legacy),
    sigs,
    ...(c.a ? { total: { top4: c.a[0], win: c.a[1], p: c.a[2] } } : {}),
    grants,
    slotExtra: c.s ?? 0,
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

export function decodeStats(w: WireStatsFile, file: string): StatsFile {
  const legacy = w.schemaVersion < 8
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
    comps: w.comps.map((c) => decodeComp(c, legacy)),
    granters: w.granters ?? [],
    baseItemIcons: w.baseItemIcons,
    patches: decodePatches(w, file),
  }
}

const PROGRESS_INTERVAL_MS = 150

export interface LoadProgress {
  /** 読めた構成の数。 */
  received: number
  /** 全体の構成数（旧ファイルは不明）。 */
  total: number | null
}

export interface LoadCallbacks {
  /**
   * 辞書まで読めた時点で1回だけ呼ぶ。comps はまだ空。画面の枠と紋章の選択面を先に出すのに使う。
   * 行の置き方が違う旧ファイルでは呼ばれない（最後に全部まとめて返る）。
   */
  onHead?: (head: StatsFile, progress: LoadProgress) => void
  /** 構成を読み進めるたびに呼ぶ。 */
  onProgress?: (progress: LoadProgress) => void
}

/**
 * data/{file} を実行時fetchしてパース・復元する。非OKレスポンスはthrow。
 * BASE_URL 基準（Cloudflare Pages ルート配信）。
 *
 * 本体は届いた順に読む（statsStream.ts）。既定ビューは gzip 後でも 1MB 前後あり、
 * 全部揃うまで何も出さないとモバイル回線では白い画面で待たされる。
 */
export async function loadStats(file: string = DEFAULT_STATS_FILE, cb: LoadCallbacks = {}): Promise<StatsFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  if (!res.ok) {
    throw new Error(`${file} fetch failed (${res.status} ${res.statusText})`)
  }
  if (!res.body) return decodeStats((await res.json()) as WireStatsFile, file)

  const parser = new StatsStreamParser()
  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  let headSent = false
  // 画面の進み具合は間引いて出す（塊ごとに描き直すと、その分だけ読み込みが遅れる）。
  let lastProgress = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
    const head = parser.head
    if (!head) continue
    const progress = { received: parser.received, total: head.compCount ?? null }
    const now = Date.now()
    if (!headSent) {
      headSent = true
      lastProgress = now
      cb.onHead?.(decodeStats(head, file), progress)
    } else if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
      lastProgress = now
      cb.onProgress?.(progress)
    }
  }
  parser.push(decoder.decode())
  return decodeStats(parser.finish(), file)
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
