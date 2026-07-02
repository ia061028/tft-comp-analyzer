import 'dotenv/config'

// Phase 2: SEA限定コレクター。
// リーグ → puuidプール → マッチID → マッチ詳細 → キュー/パッチフィルタ → NDJSON追記。

import { config, PLATFORM_TO_ROUTE, type RegionalRoute } from './config.ts'
import { RiotClient, AuthError } from './riot.ts'
import { getEmblemContext, type EmblemContext } from './cdragon.ts'
import { patchesToKeep } from './patches.ts'
import {
  loadMeta,
  saveMeta,
  loadSeen,
  appendSeen,
  appendRecords,
  pruneRecords,
  type Meta,
} from './state.ts'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ParticipantRecord } from '../shared/types.ts'

/**
 * GitHub Actions のステップ出力（$GITHUB_OUTPUT）へ key=value を追記する。
 * ローカル実行など GITHUB_OUTPUT 未設定時は完全に no-op（CI 専用の副作用を持ち込まない）。
 * この出力を後段ジョブが読み、status に応じて issue 通知 / aggregate / push を分岐する。
 */
function ghOutput(kv: Record<string, string>): void {
  const f = process.env.GITHUB_OUTPUT
  if (!f) return
  appendFileSync(f, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}

// trim はBOM（U+FEFF）や末尾改行も除去する。CI Secret 経由の混入への防御。
const apiKey = process.env.RIOT_API_KEY?.trim()
if (!apiKey) {
  console.error('RIOT_API_KEY が未設定です。.env を確認してください（.env.example 参照）')
  process.exit(1)
}

const client = new RiotClient(apiKey)

// ---- 型（Riot DTO の最小サブセット） ----

interface LeagueEntry {
  puuid?: string
  leaguePoints: number
}

interface LeagueList {
  tier: string
  entries: LeagueEntry[]
}

interface MatchTrait {
  name: string
  tier_current: number
  style: number
  /** 発動ユニット数 */
  num_units: number
}

interface MatchUnit {
  character_id: string
  itemNames?: string[]
  /** スターレベル(1-3) */
  tier?: number
}

interface MatchParticipant {
  puuid: string
  placement: number
  level: number
  traits: MatchTrait[]
  units: MatchUnit[]
}

interface MatchDetail {
  info: {
    queue_id: number
    tft_game_type: string
    game_version: string
    game_datetime: number
    participants: MatchParticipant[]
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const RECORDS_DIR = join(here, '..', 'data', 'state', 'records')

/** route の records ファイルに出現するパッチ（v）の一覧を集める。 */
function presentPatches(route: RegionalRoute): string[] {
  const path = join(RECORDS_DIR, `${route}.ndjson`)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  const set = new Set<string>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const v = (JSON.parse(trimmed) as { v?: unknown }).v
      if (typeof v === 'string') set.add(v)
    } catch {
      // パース不能行は無視（prune 側で保持される）。
    }
  }
  return [...set]
}

// ---- ホスト構築ヘルパ ----

function platformHost(platform: string): string {
  return `https://${platform}.api.riotgames.com`
}

function regionalHost(route: RegionalRoute): string {
  return `https://${route}.api.riotgames.com`
}

/** route に属するプラットフォーム一覧（PLATFORM_TO_ROUTE から逆引き）。 */
function platformsForRoute(route: RegionalRoute): string[] {
  return Object.entries(PLATFORM_TO_ROUTE)
    .filter(([, r]) => r === route)
    .map(([p]) => p)
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** master 帯から count 人をランダムに重複なしで抽選（Fisher-Yates 部分シャッフル）。 */
function sample<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr.slice()
  const copy = arr.slice()
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, count)
}

// ---- パイプライン ----

/**
 * ルートの puuid プールを構築。
 * challenger は事前取得済み（認証プリフライト結果の再利用）の場合があるため引数で受ける。
 */
async function buildPuuidPool(
  route: RegionalRoute,
  preloadedChallenger: Map<string, LeagueList | null>,
): Promise<string[]> {
  const platforms = platformsForRoute(route)
  const puuids = new Set<string>()

  for (const platform of platforms) {
    const host = platformHost(platform)

    const challenger =
      preloadedChallenger.get(platform) ??
      (await client.get<LeagueList>(`${host}/tft/league/v1/challenger`))
    const grandmaster = await client.get<LeagueList>(`${host}/tft/league/v1/grandmaster`)
    const master = await client.get<LeagueList>(`${host}/tft/league/v1/master`)

    const chalEntries = challenger?.entries ?? []
    const gmEntries = grandmaster?.entries ?? []
    const masterEntries = master?.entries ?? []

    let added = 0
    const addAll = (entries: LeagueEntry[]) => {
      for (const e of entries) {
        if (!e.puuid) continue
        if (!puuids.has(e.puuid)) {
          puuids.add(e.puuid)
          added++
        }
      }
    }
    addAll(chalEntries)
    addAll(gmEntries)

    const masterValid = masterEntries.filter((e) => e.puuid)
    const masterSampled = sample(masterValid, config.masterSamplePerPlatform)
    addAll(masterSampled)

    // Diamond I〜IV。entries エンドポイントは LeagueEntry[] を直接返す（page=1 のみ取得）。
    // 本番APIキー前提のため config.enableDiamond で切替（dev キーではレート上限回避のため既定 off）。
    let diamondSampled = 0
    if (config.enableDiamond) {
      for (const div of ['I', 'II', 'III', 'IV'] as const) {
        const entries = await client.get<LeagueEntry[]>(
          `${host}/tft/league/v1/entries/DIAMOND/${div}?page=1`,
        )
        const valid = (entries ?? []).filter((e) => e.puuid)
        const sampled = sample(valid, config.diamondSamplePerDivision)
        addAll(sampled)
        diamondSampled += sampled.length
      }
    }

    console.log(
      `  [${platform}] challenger=${chalEntries.length} grandmaster=${gmEntries.length} ` +
        `master=${masterEntries.length}(抽選${masterSampled.length}) diamond(抽選${diamondSampled}) → 新規puuid+${added}`,
    )
  }

  const pool = shuffle([...puuids])
  console.log(`  [${route}] プールサイズ（重複排除後・シャッフル済み）: ${pool.length}`)
  return pool
}

interface RouteResult {
  newMatches: number
  filteredOut: number
  dedupeSkipped: number
}

/** 1マッチの詳細を ParticipantRecord[] に変換。フィルタ通過なら配列、不通過なら null。 */
function buildRecords(matchId: string, detail: MatchDetail, emblemCtx: EmblemContext): ParticipantRecord[] | null {
  const info = detail.info
  if (info.queue_id !== config.rankedQueueId || info.tft_game_type !== 'standard') {
    return null
  }

  const versionMatch = info.game_version.match(/(\d+)\.(\d+)/)
  const v = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}` : info.game_version
  const ts = Math.floor(info.game_datetime / 1000)

  const records: ParticipantRecord[] = []
  for (const part of info.participants) {
    const t: Record<string, number> = {}
    const tc: Record<string, number> = {}
    for (const trait of part.traits) {
      if (trait.tier_current >= 1) {
        t[trait.name] = trait.style
        tc[trait.name] = trait.num_units
      }
    }

    const u: string[] = part.units.map((unit) => unit.character_id)

    const e: string[] = []
    const eh: string[] = []
    for (const unit of part.units) {
      for (const itemName of unit.itemNames ?? []) {
        // 紋章セットに含まれる、または CDragon が知らない（パッチ追従遅延対策）アイテムを収集。
        if (emblemCtx.emblemSet.has(itemName) || !emblemCtx.knownItems.has(itemName)) {
          e.push(itemName)
          eh.push(unit.character_id)
        }
      }
    }

    // ユニット別の完成アイテム（u と同インデックス）。推奨アイテム表示用。
    const ui: string[][] = part.units.map((unit) =>
      (unit.itemNames ?? []).filter((it) => emblemCtx.completedItems.has(it)),
    )

    // ユニット別のスターレベル（u と同インデックス）。
    const us: number[] = part.units.map((unit) => unit.tier ?? 0)

    records.push({
      m: matchId,
      v,
      p: part.placement,
      t,
      tc,
      e,
      eh,
      u,
      ui,
      us,
      lv: part.level,
      ts,
    })
  }
  return records
}

async function collectRoute(
  route: RegionalRoute,
  deadlineMs: number,
  meta: Meta,
  emblemCtx: EmblemContext,
  preloadedChallenger: Map<string, LeagueList | null>,
): Promise<RouteResult> {
  const result: RouteResult = { newMatches: 0, filteredOut: 0, dedupeSkipped: 0 }

  const seen = loadSeen(route)
  // 今回実行内で処理済み（seen に追記済みでもメモリ上で再確認するため別管理は不要だが、
  // appendSeen の前にメモリで弾けるよう seen 自体に都度追加する）。
  const lastRun = meta.routes[route]?.lastRunStartedAt
  const startTime = lastRun ? lastRun - 3600 : undefined

  const pool = await buildPuuidPool(route, preloadedChallenger)
  const rHost = regionalHost(route)

  let processedSinceLog = 0

  outer: for (const puuid of pool) {
    if (Date.now() >= deadlineMs) {
      console.log(`  [${route}] デッドライン到達。取得打ち切り。`)
      break
    }
    if (result.newMatches >= config.maxNewMatchesPerRoutePerRun) {
      console.log(`  [${route}] 新規記録上限 ${config.maxNewMatchesPerRoutePerRun} 到達。打ち切り。`)
      break
    }

    let idsUrl = `${rHost}/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${config.matchIdsPerPlayer}`
    if (startTime !== undefined) idsUrl += `&startTime=${startTime}`
    const ids = await client.get<string[]>(idsUrl)
    if (!ids) continue

    for (const id of ids) {
      if (Date.now() >= deadlineMs) {
        console.log(`  [${route}] デッドライン到達。取得打ち切り。`)
        break outer
      }
      if (result.newMatches >= config.maxNewMatchesPerRoutePerRun) {
        console.log(`  [${route}] 新規記録上限 ${config.maxNewMatchesPerRoutePerRun} 到達。打ち切り。`)
        break outer
      }
      if (seen.has(id)) {
        result.dedupeSkipped++
        continue
      }

      const detail = await client.get<MatchDetail>(`${rHost}/tft/match/v1/matches/${id}`)
      if (!detail) {
        // 404 等。再取得防止のため seen に追記。
        seen.add(id)
        appendSeen(route, [id])
        continue
      }

      const records = buildRecords(id, detail, emblemCtx)
      seen.add(id)
      if (records === null) {
        // フィルタ破棄。ID は seen に追記して再取得を防ぐ。
        result.filteredOut++
        appendSeen(route, [id])
      } else {
        // seen を先に追記: 間でクラッシュした場合「1マッチ取りこぼし」で済む。
        // 逆順だと records が重複追記され集計が歪むため、こちらを優先。
        appendSeen(route, [id])
        appendRecords(route, records)
        result.newMatches++
      }

      processedSinceLog++
      if (processedSinceLog >= 50) {
        console.log(
          `  [${route}] 進捗: 新規=${result.newMatches} 破棄=${result.filteredOut} dedupe=${result.dedupeSkipped}`,
        )
        processedSinceLog = 0
      }
    }
  }

  return result
}

// ---- エントリポイント ----

async function main(): Promise<void> {
  const runStartedAt = Math.floor(Date.now() / 1000)
  const startWallMs = Date.now()
  const deadlineMs = startWallMs + (config.runBudgetMinutes - 5) * 60 * 1000

  // 認証プリフライト: ルート内先頭プラットフォームの challenger を1回叩く。
  // AuthError なら state に一切触れず exit 1。結果は後続のプール構築で再利用。
  const preloaded = new Map<string, LeagueList | null>()
  for (const route of config.enabledRoutes) {
    const platforms = platformsForRoute(route)
    const first = platforms[0]
    try {
      const league = await client.get<LeagueList>(
        `${platformHost(first)}/tft/league/v1/challenger`,
      )
      preloaded.set(first, league)
      console.log(
        `[${route}] 認証プリフライト OK (${first} challenger=${league?.entries.length ?? 0})`,
      )
    } catch (err) {
      if (err instanceof AuthError) {
        // キー失効は想定内（開発キーは24h失効）。ここで exit 1 にすると6時間ごとの
        // CI が赤失敗し、失敗メールが繰り返し届く。state には一切触れていないので
        // ::warning:: アノテーションを出して正常終了し、ジョブは成功扱いにする。
        // 既存 state / stats.json は不変で、サイトは前回データを配信し続ける。
        console.log(
          `::warning::認証エラー: ${err.message}。キー失効と判断し収集をスキップ（state は不変・前回データを配信継続）。`,
        )
        // 後段ジョブへ「キー失効 no-op」を伝える。これがスティッキー issue 起票の条件になり、
        // aggregate / data ブランチ push / stats.json コミットは全てスキップされる（デプロイ0）。
        ghOutput({ status: 'auth_expired' })
        process.exit(0)
      }
      throw err
    }
  }

  // 静的データ（紋章コンテキスト）取得。
  const emblemCtx = await getEmblemContext()
  console.log(
    `CDragon: 紋章 ${emblemCtx.emblemSet.size} 種 / 既知アイテム ${emblemCtx.knownItems.size} 種`,
  )

  const meta = loadMeta()

  // ルート並列実行。RiotClient はホスト別リミッタを持つため1インスタンス共有で安全。
  // 1ルートが例外で落ちても他ルートの結果を失わないよう allSettled を使う。
  console.log(`\n=== ルート並列収集開始: ${config.enabledRoutes.join(', ')} ===`)
  const settled = await Promise.allSettled(
    config.enabledRoutes.map((route) =>
      collectRoute(route, deadlineMs, meta, emblemCtx, preloaded).then(
        (result) => ({ route, result }),
      ),
    ),
  )

  // 成功ルートのみ meta 更新。saveMeta は全ルート完了後に1回だけ呼ぶ。
  const routeResults: { route: RegionalRoute; result: RouteResult }[] = []
  let anyRouteFailed = false
  for (let i = 0; i < settled.length; i++) {
    const route = config.enabledRoutes[i]
    const s = settled[i]
    if (s.status === 'fulfilled') {
      routeResults.push(s.value)
      meta.routes[route] = { lastRunStartedAt: runStartedAt }
    } else {
      anyRouteFailed = true
      console.error(`[${route}] 収集中に例外: ${s.reason}`)
    }
  }
  saveMeta(meta)

  // prune: ルートごとに records に出現するパッチを集め、上位2パッチのみ保持。
  console.log('\n=== prune（旧パッチ削除） ===')
  for (const route of config.enabledRoutes) {
    const keep = patchesToKeep(presentPatches(route))
    const { kept, dropped } = pruneRecords(route, keep)
    console.log(
      `  [${route}] 保持パッチ={${[...keep].join(', ')}} kept=${kept} dropped=${dropped}`,
    )
  }

  // 最終サマリ（全ルート分まとめ）。
  const elapsedSec = ((Date.now() - startWallMs) / 1000).toFixed(1)
  const stats = client.stats()
  console.log('\n=== 最終サマリ ===')
  let totalNew = 0
  let totalFiltered = 0
  let totalDedupe = 0
  for (const { route, result } of routeResults) {
    totalNew += result.newMatches
    totalFiltered += result.filteredOut
    totalDedupe += result.dedupeSkipped
    console.log(
      `  [${route}] 新規=${result.newMatches} 破棄=${result.filteredOut} dedupe=${result.dedupeSkipped}`,
    )
  }
  console.log(`  合計: 新規=${totalNew} 破棄=${totalFiltered} dedupe=${totalDedupe}`)
  console.log(`  経過時間: ${elapsedSec}s`)
  console.log(`  Riot統計(全体): req=${stats.total.requests} 429retry=${stats.total.retries429}`)
  console.log(`  ステータス別: ${JSON.stringify(stats.total.byStatus)}`)
  for (const [host, hs] of Object.entries(stats.byHost)) {
    console.log(
      `    [${host}] req=${hs.requests} 429retry=${hs.retries429} status=${JSON.stringify(hs.byStatus)}`,
    )
  }

  console.log('\n収集完了。')
  if (anyRouteFailed) {
    // 実エラー（ルート例外）は従来どおり exit 1 で赤失敗させ、失敗通知を維持する。
    // ここでは status を書かない: 後段ステップは status=='ok' 条件で全てスキップされ、
    // 加えて exit 1 でジョブが赤になる。想定内の no-op（auth_expired）とは明確に区別する。
    console.error('一部ルートが失敗しました（成功ルートの meta は保存済み）。exit 1。')
    process.exit(1)
  }

  // 全ルート成功。後段（aggregate → data ブランチ squash push → stats.json コミット/デプロイ）を起動。
  // new_records は「今回追記した新規マッチ数の合計」（＝各ルート result.newMatches の総和 totalNew）。
  // 1マッチ=最大8参加者レコードだが、収集側で追跡している集計単位はマッチ数なのでこれを採用する。
  ghOutput({ status: 'ok', new_records: String(totalNew) })
}

await main()
