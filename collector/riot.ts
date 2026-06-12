// Riot API クライアント。ホスト（ルーティング値）ごとに独立したレートリミッタを持つ。
// プラットフォームホスト（sg2.api.riotgames.com 等）とリージョナルホスト（sea.api.riotgames.com）
// は別々のバケットとして扱われる。

/** 401/403。呼び出し側がキー失効と判断して即終了するための専用エラー型。 */
export class AuthError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

/** ホストごとの統計 */
export interface HostStats {
  requests: number
  byStatus: Record<number, number>
  retries429: number
}

interface Limiter {
  // スライディングウィンドウ用に各リクエストの送信タイムスタンプ（ms）を保持
  shortWindow: number[]
  longWindow: number[]
  // 直列化用の待ち行列（同一ホストへのリクエストを逐次化）
  chain: Promise<void>
}

// 安全マージン込みの実効上限。
// 20req/1s → 19req/1.05s、100req/120s → 98req/122s。
const SHORT_LIMIT = 19
const SHORT_WINDOW_MS = 1050
const LONG_LIMIT = 98
const LONG_WINDOW_MS = 122000

const MAX_429_RETRIES = 5
const MAX_5XX_RETRIES = 3
const DEFAULT_RETRY_AFTER_MS = 10000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RiotClient {
  private apiKey: string
  private limiters = new Map<string, Limiter>()
  private statsByHost = new Map<string, HostStats>()

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private getLimiter(host: string): Limiter {
    let limiter = this.limiters.get(host)
    if (!limiter) {
      limiter = { shortWindow: [], longWindow: [], chain: Promise.resolve() }
      this.limiters.set(host, limiter)
    }
    return limiter
  }

  private getStats(host: string): HostStats {
    let s = this.statsByHost.get(host)
    if (!s) {
      s = { requests: 0, byStatus: {}, retries429: 0 }
      this.statsByHost.set(host, s)
    }
    return s
  }

  /** スライディングウィンドウ条件を満たすまで待機し、送信を記録する。 */
  private async acquire(limiter: Limiter): Promise<void> {
    // 同一ホストへのリクエストを逐次化して、ウィンドウ計算の競合を防ぐ。
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const prev = limiter.chain
    limiter.chain = prev.then(() => next)
    await prev

    try {
      for (;;) {
        const now = Date.now()
        const shortCut = now - SHORT_WINDOW_MS
        const longCut = now - LONG_WINDOW_MS
        while (limiter.shortWindow.length && limiter.shortWindow[0] <= shortCut) {
          limiter.shortWindow.shift()
        }
        while (limiter.longWindow.length && limiter.longWindow[0] <= longCut) {
          limiter.longWindow.shift()
        }

        let waitMs = 0
        if (limiter.shortWindow.length >= SHORT_LIMIT) {
          waitMs = Math.max(waitMs, limiter.shortWindow[0] + SHORT_WINDOW_MS - now)
        }
        if (limiter.longWindow.length >= LONG_LIMIT) {
          waitMs = Math.max(waitMs, limiter.longWindow[0] + LONG_WINDOW_MS - now)
        }
        if (waitMs <= 0) break
        await sleep(waitMs)
      }
      const ts = Date.now()
      limiter.shortWindow.push(ts)
      limiter.longWindow.push(ts)
    } finally {
      release()
    }
  }

  /**
   * 指定 URL を GET する。host は URL のホスト名（バケットキー）。
   * 404 は null を返す。401/403 は AuthError。5xx/429 はリトライ。
   */
  async get<T>(url: string): Promise<T | null> {
    const host = new URL(url).host
    const limiter = this.getLimiter(host)
    const stats = this.getStats(host)

    let attempts429 = 0
    let attempts5xx = 0

    for (;;) {
      await this.acquire(limiter)

      let res: Response
      try {
        res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } })
      } catch (err) {
        // ネットワークエラーは 5xx と同様に指数バックオフ。
        if (attempts5xx >= MAX_5XX_RETRIES) throw err
        const backoff = 2000 * 2 ** attempts5xx
        attempts5xx++
        await sleep(backoff)
        continue
      }

      stats.requests++
      stats.byStatus[res.status] = (stats.byStatus[res.status] ?? 0) + 1

      if (res.ok) {
        return (await res.json()) as T
      }

      if (res.status === 404) {
        // ボディを読み切って接続を解放。
        await res.text().catch(() => undefined)
        return null
      }

      if (res.status === 401 || res.status === 403) {
        await res.text().catch(() => undefined)
        throw new AuthError(res.status, `認証エラー ${res.status}: APIキーが無効または失効`)
      }

      if (res.status === 429) {
        await res.text().catch(() => undefined)
        if (attempts429 >= MAX_429_RETRIES) {
          throw new Error(`429 リトライ上限超過: ${url}`)
        }
        const retryAfter = res.headers.get('Retry-After')
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : DEFAULT_RETRY_AFTER_MS
        stats.retries429++
        attempts429++
        await sleep(Number.isFinite(waitMs) && waitMs > 0 ? waitMs : DEFAULT_RETRY_AFTER_MS)
        continue
      }

      if (res.status >= 500) {
        await res.text().catch(() => undefined)
        if (attempts5xx >= MAX_5XX_RETRIES) {
          throw new Error(`5xx リトライ上限超過: ${res.status} ${url}`)
        }
        const backoff = 2000 * 2 ** attempts5xx
        attempts5xx++
        await sleep(backoff)
        continue
      }

      // その他の 4xx は例外。
      const body = await res.text().catch(() => '')
      throw new Error(`Riot API エラー ${res.status} ${url}: ${body.slice(0, 200)}`)
    }
  }

  /** ホストごと＋全体の統計を返す。 */
  stats(): { byHost: Record<string, HostStats>; total: HostStats } {
    const byHost: Record<string, HostStats> = {}
    const total: HostStats = { requests: 0, byStatus: {}, retries429: 0 }
    for (const [host, s] of this.statsByHost) {
      byHost[host] = s
      total.requests += s.requests
      total.retries429 += s.retries429
      for (const [code, count] of Object.entries(s.byStatus)) {
        const n = Number(code)
        total.byStatus[n] = (total.byStatus[n] ?? 0) + count
      }
    }
    return { byHost, total }
  }
}
