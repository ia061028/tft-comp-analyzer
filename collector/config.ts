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
  /** 1ルート1実行あたりの新規マッチ詳細取得の上限 */
  maxNewMatchesPerRoutePerRun: 1000,
  /** Master帯からプラットフォームごとに抽選する人数の上限 */
  masterSamplePerPlatform: 100,
  /**
   * Diamond帯も収集対象に含めるか。dev キーのレート上限を避けるため既定 false。
   * 本番APIキー切替後に true にする。
   */
  enableDiamond: false,
  /** Diamond帯からプラットフォーム×ディビジョンごとに抽選する人数の上限 */
  diamondSamplePerDivision: 50,
  /** 構成クラスタキーに含めるトレイトの最小style（3=ゴールド以上） */
  clusterMinStyle: 3,
  /** クラスタキーに含める上位トレイト数（スタイル降順で上位N件のみをキー化） */
  clusterMaxKeyTraits: 2,
  /** 新パッチがこの試合数を超えたら集計対象を切替・旧パッチをprune */
  patchSwitchThreshold: 200,
  /** 実行時間バジェット（分）。残り5分で取得を打ち切り集計とflushを実施 */
  runBudgetMinutes: 30,
  /** ランク戦TFTの queue_id */
  rankedQueueId: 1100,
  /**
   * 内部パッチキー（game_version 由来）→ 表示用 TFT バージョン。
   * 計算で導けないため手動マップ。新パッチごとに1行追加。未登録は素のパッチ表示にフォールバック。
   */
  tftPatchLabels: {
    '16.13': '17.6',
    '16.12': '17.5',
    '16.11': '17.4',
  } as Record<string, string>,
}
