export type RegionalRoute = 'americas' | 'asia' | 'europe' | 'sea'

/** TFTの全15プラットフォームとリージョナルルーティングの対応（oc1 は sea 扱い） */
export const PLATFORM_TO_ROUTE: Record<string, RegionalRoute> = {
  na1: 'americas',
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  kr: 'asia',
  jp1: 'asia',
  euw1: 'europe',
  eun1: 'europe',
  tr1: 'europe',
  ru: 'europe',
  me1: 'europe',
  oc1: 'sea',
  sg2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
}

export const config = {
  /** 有効なリージョナルルート。Phase 5 で全4ルート（全15プラットフォーム）に拡大。 */
  enabledRoutes: ['americas', 'asia', 'europe', 'sea'] as RegionalRoute[],
  /** マッチID取得時の count パラメータ */
  matchIdsPerPlayer: 20,
  /**
   * 1ルート1実行あたりの新規マッチ詳細取得の上限。
   * レート上限（リージョナルホストごとに 100req/120s = 50req/分）と runBudgetMinutes から算出。
   * 収集30分 × 50req/分 = 1,500 が1ルートの理論上限。
   */
  maxNewMatchesPerRoutePerRun: 1500,
  /** Master帯からプラットフォームごとに抽選する人数の上限 */
  masterSamplePerPlatform: 100,
  /**
   * entries エンドポイント（DIAMOND 以下）で puuid プールに加えるティア。
   * 高レート帯だけだと母集団が枯れる（セット開始直後は全15プラットフォームで
   * Challenger/GM が 0人、Master 計30人だった）。サンプル数を最大化するため全ティアを対象にする。
   * 注意: 低レート帯の構成は最適解とは限らないので、統計の解釈は「その帯で実際に組まれた構成」。
   */
  entryTiers: ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'] as const,
  /** entries ティア×ディビジョンごとに抽選する人数の上限（1ページ205件上限から抽選） */
  entrySamplePerDivision: 15,
  /**
   * ローリング窓: records/{route}.ndjson に保持する最大レコード数。
   * GitHub のハード上限は 100MB/ファイル。実測 約900バイト/レコードなので
   * 90,000 レコード ≒ 81MB（約11,250マッチ）に抑える。4ルートで約45,000マッチが定常サンプル。
   */
  maxRecordsPerRoute: 90000,
  /** 集計対象パッチのヒステリシス閾値（この試合数を超えた最新パッチへ切替）。prune とは無関係。 */
  patchSwitchThreshold: 200,
  /** 実行時間バジェット（分）。残り5分で取得を打ち切り集計とflushを実施 */
  runBudgetMinutes: 35,
  /** ランク戦TFTの queue_id */
  rankedQueueId: 1100,
  /**
   * 内部パッチキー（game_version 由来）→ 表示用 TFT バージョン。
   * 計算で導けないため手動マップ。新パッチごとに1行追加。未登録は素のパッチ表示にフォールバック
   * （aggregate が警告を出すので見落とさない）。
   *
   * セット18（Unreal 移行後）は Riot が game_version を
   * "TFT Unreal Version ?.?.?.?" というプレースホルダで返し、パッチ番号を一切公開しない
   * （2026-08-29 の実データで確認）。そのため collect が tft_set_number から "18.0" を合成する。
   * パッチ単位の分離はセット18 では不可能なので、表示も「18.x」（パッチ不明）とする。
   * Riot が game_version を修正したら実パッチキー（例 "18.2"）が現れるので、その時に行を追加する。
   */
  tftPatchLabels: {
    '18.0': '18.x',
    '16.13': '17.6',
    '16.12': '17.5',
    '16.11': '17.4',
  } as Record<string, string>,
}
