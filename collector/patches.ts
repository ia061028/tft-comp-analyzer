// パッチバージョンの比較・選定・prune 判定を行う純関数群。
// 副作用なし・I/O なしでテスト可能に保つ。

/**
 * "16.12" 形式のパッチを数値ペアで比較する。
 * "16.9" < "16.10" を文字列比較ではなく数値で正しく扱う。
 * パース不能（数値ペアにならない）は最小として扱う。
 * 戻り値: a<b で負、a>b で正、等値で 0。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa[0] !== pb[0]) return pa[0] - pb[0]
  return pa[1] - pb[1]
}

// パース不能パッチを表す最小センチネル。Infinity を使うと両方不能時に
// Infinity - Infinity = NaN となり比較が不安定になるため有限値を使う。
const MIN_SENTINEL = Number.MIN_SAFE_INTEGER

/** "16.12" → [16, 12]。パース不能は最小扱い（センチネル）。 */
function parseVersion(v: string): [number, number] {
  const m = v.match(/^(\d+)\.(\d+)/)
  if (!m) return [MIN_SENTINEL, MIN_SENTINEL]
  return [Number(m[1]), Number(m[2])]
}

/**
 * パッチヒステリシス: 集計対象パッチを選ぶ。
 * - パッチをバージョン降順に並べ、ユニークマッチ数 >= threshold を満たす
 *   最初（最新）のパッチを返す。
 * - どれも満たさなければマッチ数最多（同数ならバージョン新しい方）を返す。
 * - 空 Map は null。
 *
 * @param matchCountByPatch パッチ → ユニークマッチID数
 */
export function pickTargetPatch(
  matchCountByPatch: Map<string, number>,
  threshold: number,
): string | null {
  const entries = [...matchCountByPatch.entries()]
  if (entries.length === 0) return null

  // バージョン降順（新しい順）。
  const byVersionDesc = [...entries].sort((a, b) => compareVersions(b[0], a[0]))
  for (const [patch, count] of byVersionDesc) {
    if (count >= threshold) return patch
  }

  // 閾値未達: マッチ数最多、同数ならバージョン新しい方。
  let best = entries[0]
  for (const e of entries) {
    if (e[1] > best[1] || (e[1] === best[1] && compareVersions(e[0], best[0]) > 0)) {
      best = e
    }
  }
  return best[0]
}

// ---- 日時ベースのパッチ割り当て（Unreal 移行後の game_version プレースホルダ対策） ----

export interface PatchScheduleEntry {
  /** TFT パッチ表記（例 "18.2"）。そのまま表示ラベルになる。 */
  patch: string
  /** このパッチの配信開始（ISO 8601, UTC）。 */
  since: string
}

/**
 * collect が game_version から数値を取れず tft_set_number から合成した "{set}.0" 形式か。
 * TFT の実パッチは x.1 始まりなので、minor=0 は合成キーと断定できる。
 */
export function isSynthesizedPatch(v: string): boolean {
  return /^\d+\.0$/.test(v)
}

/**
 * レコードのパッチキーを決める。
 * - v が実パッチ（"18.2" 等）ならそのまま返す。
 * - v が合成キー（"18.0"）なら、同じメジャー（=セット番号）のスケジュールから
 *   `since <= ts` を満たす最新エントリの patch を返す。該当なし（スケジュール未登録、
 *   または最初の配信より前の ts）なら v をそのまま返す。
 *
 * @param ts game_datetime（epoch 秒）
 */
export function resolvePatch(v: string, ts: number, schedule: PatchScheduleEntry[]): string {
  if (!isSynthesizedPatch(v)) return v
  const major = v.slice(0, v.indexOf('.'))
  const tsMs = ts * 1000
  let resolved = v
  let resolvedSince = -Infinity
  for (const entry of schedule) {
    if (!entry.patch.startsWith(`${major}.`)) continue
    const since = Date.parse(entry.since)
    if (Number.isNaN(since) || since > tsMs) continue
    if (since >= resolvedSince) {
      resolved = entry.patch
      resolvedSince = since
    }
  }
  return resolved
}

/** 集計ビュー。key はファイル名と UI の選択キーに使う（"all" は全パッチ合算）。 */
export interface PatchView {
  key: string
  /** このビューに含めるパッチキー群。 */
  patches: string[]
}

export const ALL_PATCHES_KEY = 'all'

/**
 * 出力する集計ビューを決める。
 * - ユニークマッチ数 >= threshold のパッチはそれぞれ単独ビューになる（バージョン昇順）。
 * - 既定ビュー（pickTargetPatch のヒステリシス選定）は閾値未達でも必ず含める。
 * - 単独ビューが2つ以上あるときだけ、先頭に全パッチ合算ビュー（"all"）を付ける。
 *   1つしか無ければ合算と同じ内容になるので出さない。
 * - 空 Map は views 空・defaultKey null。
 */
export function planPatchViews(
  matchCountByPatch: Map<string, number>,
  threshold: number,
): { defaultKey: string | null; views: PatchView[] } {
  const defaultKey = pickTargetPatch(matchCountByPatch, threshold)
  if (defaultKey === null) return { defaultKey: null, views: [] }

  const single = [...matchCountByPatch.entries()]
    .filter(([patch, count]) => count >= threshold || patch === defaultKey)
    .map(([patch]) => patch)
    .sort(compareVersions)

  const views: PatchView[] = single.map((patch) => ({ key: patch, patches: [patch] }))
  if (single.length >= 2) {
    const all = [...matchCountByPatch.keys()].sort(compareVersions)
    views.unshift({ key: ALL_PATCHES_KEY, patches: all })
  }
  return { defaultKey, views }
}
