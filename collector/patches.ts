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

/**
 * prune 用: 存在するパッチのうちバージョン上位2つを返す。
 * 2つ以下なら全部。直近2パッチを保持する方針に対応。
 */
export function patchesToKeep(present: string[]): Set<string> {
  const sorted = [...new Set(present)].sort((a, b) => compareVersions(b, a))
  return new Set(sorted.slice(0, 2))
}
