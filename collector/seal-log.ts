// 封印・保持適用の結果を整形してログに出す（collect.ts と seal.ts で共用）。

import type { RouteShards, SealResult } from './shards.ts'
import type { RetentionPlan } from './retention.ts'

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1) + 'MB'

export function logSealAndPrune(
  route: string,
  r: { sealed: SealResult | null; plan: RetentionPlan; after: RouteShards },
): void {
  if (r.sealed) {
    const s = r.sealed
    console.log(
      `  [${route}] 封印: ${s.meta.file} raw=${mb(s.rawBytes)} gz=${mb(s.meta.gzBytes)} ` +
        `records=${s.records} matches=${s.matches}`,
    )
  } else {
    console.log(`  [${route}] 封印: なし（アクティブが閾値以下）`)
  }
  for (const { shard, reason } of r.plan.drop) {
    console.log(`  [${route}] 削除(${reason}): ${shard.file} gz=${mb(shard.gzBytes)}`)
  }
  const total = r.after.sealed.reduce((s, x) => s + x.gzBytes, 0)
  console.log(
    `  [${route}] 保持: セット=${r.plan.currentSet ?? '-'} floor=${r.plan.floor ?? '-'} ` +
      `封印シャード=${r.after.sealed.length} gz合計=${mb(total)} アクティブ=${r.after.active ? 'あり' : 'なし'}`,
  )
}
