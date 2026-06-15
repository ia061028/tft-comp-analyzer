import type { StatsFile } from '../../shared/types'

/** data/stats.json を実行時fetchしてパースする。非OKレスポンスはthrow。
 * BASE_URL 基準にすることで GitHub Pages の project サブパス配信に対応。 */
export async function loadStats(): Promise<StatsFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/stats.json`)
  if (!res.ok) {
    throw new Error(`stats.json fetch failed (${res.status} ${res.statusText})`)
  }
  return (await res.json()) as StatsFile
}
