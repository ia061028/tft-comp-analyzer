import type { StatsFile } from '../../shared/types'

/** /data/stats.json を実行時fetchしてパースする。非OKレスポンスはthrow。 */
export async function loadStats(): Promise<StatsFile> {
  const res = await fetch('/data/stats.json')
  if (!res.ok) {
    throw new Error(`stats.json の取得に失敗しました (${res.status} ${res.statusText})`)
  }
  return (await res.json()) as StatsFile
}
