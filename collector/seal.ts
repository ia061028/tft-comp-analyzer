import 'dotenv/config'

// 収集せずに封印と保持適用だけを行う CLI（npm run data:seal）。
// ローカルでの移行確認や、手動で封印したいときに使う。Riot API キーは不要。

import { config, KNOWN_ROUTES } from './config.ts'
import { RECORDS_DIR, ensureDataGitattributes } from './state.ts'
import { listRouteShards, sealAndPrune } from './shards.ts'
import { logSealAndPrune } from './seal-log.ts'

async function main(): Promise<void> {
  if (ensureDataGitattributes()) console.log('.gitattributes を更新')
  const routes = listRouteShards(RECORDS_DIR, KNOWN_ROUTES, (m) => console.warn(`  警告: ${m}`))
  if (routes.size === 0) {
    console.error(`records が見つかりません: ${RECORDS_DIR}`)
    process.exit(1)
  }
  for (const route of routes.keys()) {
    const r = await sealAndPrune(RECORDS_DIR, route, {
      sealThresholdBytes: config.sealThresholdBytes,
      schedule: config.patchSchedule,
      patchesToKeep: config.patchesToKeep,
      maxGzBytes: config.maxSealedBytesPerRoute,
      nowMs: Date.now(),
    })
    logSealAndPrune(route, r)
  }
}

await main()
