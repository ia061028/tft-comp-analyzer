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
  /**
   * マッチID取得時の count パラメータ（API 上限は 200）。
   *
   * ここが収集効率を直接決める。1プレイヤーにつき ID 取得リクエストが必ず1回要るので、
   * 1回で拾える試合数が少ないほどレート上限を ID 取得で食い潰す。
   * count=20・取得窓6時間だった時の実測は「1人あたり新規0.5試合」で、
   * リージョナルホストの全リクエストの約7割が ID 取得に消えていた（効率30%）。
   * 200 にして取得窓もセット開始まで広げると、1回の ID 取得で数十試合を拾えるようになる。
   */
  matchIdsPerPlayer: 200,
  /**
   * 1ルート1実行あたりの新規マッチ詳細取得の上限。
   * ローリング窓の1ルート分（maxRecordsPerRoute / 8人 ≒ 11,250マッチ）を1ランで埋め切れる値にする。
   * 実際にはレート上限由来のデッドラインが先に効くので、暴走防止の非拘束キャップ。
   */
  maxNewMatchesPerRoutePerRun: 12000,
  /** Master帯からプラットフォームごとに抽選する人数の上限 */
  masterSamplePerPlatform: 100,
  /**
   * entries エンドポイント（DIAMOND 以下）で puuid プールに加えるティア。
   * 高レート帯だけだと母集団が枯れる（セット開始直後は全15プラットフォームで
   * Challenger/GM が 0人、Master 計30人だった）。サンプル数を最大化するため全ティアを対象にする。
   * 注意: 低レート帯の構成は最適解とは限らないので、統計の解釈は「その帯で実際に組まれた構成」。
   */
  entryTiers: ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'] as const,
  /**
   * entries ティア×ディビジョンごとに抽選する人数の上限（1ページ205件が API 上限）。
   * 205 = ページ全件。プール構築のリクエスト数は抽選数に依らず
   * ティア×ディビジョン数（7×4=28/プラットフォーム）で一定なので、全件取るのが最も効率的。
   * 1プラットフォーム約5,700人 → 1ルート約23,000人。長時間ランでもプールが枯れない。
   */
  entrySamplePerDivision: 205,
  /**
   * ローリング窓: records/{route}.ndjson に保持する最大レコード数。
   * GitHub のハード上限は 100MB/ファイル。実測 約900バイト/レコードなので
   * 90,000 レコード ≒ 81MB（約11,250マッチ）に抑える。4ルートで約45,000マッチが定常サンプル。
   */
  maxRecordsPerRoute: 90000,
  /** 集計対象パッチのヒステリシス閾値（この試合数を超えた最新パッチへ切替）。prune とは無関係。 */
  patchSwitchThreshold: 200,
  /**
   * 実行時間バジェット（分）。残り5分で取得を打ち切り集計とflushを実施。
   *
   * 頻度ではなく1ランの長さで総量を稼ぐ設計にしている。理由:
   * - レート上限は時間あたり（50req/分）なので、走らせている時間がそのまま総量になる。
   *   6時間ごと4ラン × 35分では日あたり利用率が8%しかなかった。
   * - 収集間隔が短いほど「プレイヤー1人あたりの新規試合」が減り、試合ID取得1回あたりの
   *   収穫が落ちる（実測: 6時間窓で平均0.5試合/人 → リクエストの2/3がID取得に消えていた）。
   * - ラン頻度を上げると stats.json のコミット＝Cloudflare Pages のビルドも増え、
   *   無料枠 500ビルド/月に当たる。6時間ごと（月120ビルド）を維持するのが安全。
   */
  runBudgetMinutes: 120,
  /** ランク戦TFTの queue_id */
  rankedQueueId: 1100,
  /**
   * 試合ID取得の下限時刻（epoch秒）。既定は セット18 の稼働開始 2026-08-26T00:00:00Z。
   *
   * 前回実行時刻を基準に窓を刻むのをやめ、常にセット全期間を対象にする。重複は seen が
   * 弾くのでリクエストを消費せず、代わりに ID 取得1回あたりの収穫が跳ね上がる。
   * セットが替わったらこの値を新セットの開始時刻に更新する（tftPatchLabels と同じ運用）。
   */
  collectSinceEpoch: 1787702400,
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
