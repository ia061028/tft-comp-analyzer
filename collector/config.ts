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

/** records/ 配下で認めるルート名（ファイル名・ディレクトリ名のホワイトリスト）。 */
export const KNOWN_ROUTES: ReadonlySet<string> = new Set(Object.values(PLATFORM_TO_ROUTE))

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
   * レート上限由来のデッドライン（1ランあたり約5,000マッチ/ルート）が先に効くので、暴走防止の非拘束キャップ。
   */
  maxNewMatchesPerRoutePerRun: 12000,
  /**
   * 母集団は Challenger / Grandmaster / Master の全員（抽選しない）。
   * ルート内の Master 以上の合計がこの人数未満のときだけ、entries（Diamond 以下）で補充する
   * （セット開始直後は全15プラットフォームで Challenger/GM が 0人、Master 計30人だった）。
   * 低レート帯の構成は最適解とは限らないので、補充が入ったランはログに明示する。
   */
  minHighTierPoolPerRoute: 500,
  /**
   * 1ルートのプール上限。超えたらランダムに間引く（vn2 だけで Master 以上が約3,500人いる）。
   * 1ランで回れるのは 1,000〜2,000 人なので、これより大きくても意味が無い。
   */
  maxPoolPerRoute: 6000,
  /**
   * フォールバック時に entries エンドポイントで加えるティア（上から順）。
   */
  entryTiers: ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'] as const,
  /**
   * entries ティア×ディビジョンごとに抽選する人数の上限（1ページ205件が API 上限）。
   * 205 = ページ全件。プール構築のリクエスト数は抽選数に依らず
   * ティア×ディビジョン数（7×4=28/プラットフォーム）で一定なので、全件取るのが最も効率的。
   */
  entrySamplePerDivision: 205,
  /**
   * 封印閾値: ラン末尾にアクティブシャード（records/{route}.ndjson）がこれを超えていたら
   * 丸ごと gzip して封印シャード（records/{route}/…ndjson.gz）にする。
   * 1ラン約6.5MB/ルートなので約10ランに1回。封印シャードは最大でも閾値＋1ラン分で、
   * GitHub の 100MB/ファイル上限（非圧縮 blob）に本番キーでも当たらない。gzip 後は約1/10。
   */
  sealThresholdBytes: 64 * 1024 * 1024,
  /**
   * 保持予算（主規則）: 1ルートの封印シャードの gzip 合計がこれを超えたら、古いシャードから消す。
   * 実測 1MB gz ≒ 1,630 マッチなので 64MB ≒ 約10万マッチ/ルート ≒ 4ルート合計約42万マッチ
   * ≒ パッチ約2本分。現パッチが増えるにつれ前パッチのシャードが古い順に押し出される。
   * data ブランチの到達サイズは 4×64MB ≒ 256MB。
   */
  maxSealedBytesPerRoute: 64 * 1024 * 1024,
  /**
   * 保持上限（上限規則）: 予算に余りがあっても、直近 N パッチより古いパッチのレコードは残さない。
   * パッチ境界は patchSchedule（下記）から求める。
   */
  patchesToKeep: 2,
  /**
   * マッチ ID 取得の下限を「配信済みの直近 N パッチ」に限定する（1 = 最新パッチのみ）。
   * 保持（patchesToKeep）とは独立: 前パッチのレコードは残すが、新たに取りには行かない。
   * 母集団を切り替えた直後にプレイヤーの履歴をセット開始まで遡ると前パッチの試合ばかり
   * 溜まるため、最新パッチだけを取るのが既定。新パッチ配信後に patchSchedule へ追加するまでは
   * 前パッチの配信開始が下限になるので、取りこぼしは無い（新パッチの試合も含まれる）。
   */
  collectPatchesBack: 1,
  /** 集計対象パッチのヒステリシス閾値（この試合数を超えた最新パッチへ切替）。保持とは無関係。 */
  patchSwitchThreshold: 200,
  /**
   * 1ビュー（stats-*.json）に出力する構成数の上限（n 降順で切る。0 で無制限）。
   * 1構成約260バイトなので 20,000 で約5MB。データ量が増えるほど n>=3 の構成が増えて
   * ファイルが肥大化するため、ここで抑える。40万マッチ規模では実質 n≒8〜10 未満が切られる。
   */
  maxCompsPerView: 20000,
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
   * （2026-08-29 の実データで確認）。そのため collect が tft_set_number から "18.0" を合成し、
   * aggregate が下の patchSchedule（配信日時）で実パッチに割り当て直す。"18.0" が残るのは
   * スケジュール未登録の期間だけで、その表示が「18.x」（パッチ不明）。
   * Riot が game_version を修正したら実パッチキー（例 "18.3"）が現れるので、その時に行を追加する
   * （patchSchedule 由来のキーは TFT 表記そのものなので、この表への登録は不要）。
   */
  tftPatchLabels: {
    '18.0': '18.x',
    '16.13': '17.6',
    '16.12': '17.5',
    '16.11': '17.4',
  } as Record<string, string>,
  /**
   * 日時ベースのパッチ境界（セット18〜）。パッチ配信日時の昇順。
   *
   * game_version がプレースホルダのため v は "{set}.0" に潰れる。そこで aggregate が
   * 各レコードの game_datetime（ts）をこの表に当てて TFT パッチを割り当て、パッチ別に
   * 集計する（stats-{patch}.json）。`patch` はそのまま表示用 TFT 表記になる。
   *
   * since は UTC。実際の配信はリージョンごとに数時間ずれる（OCE→KR→EU→NA の順で
   * 前日夜〜当日昼 UTC）が、配信前後はメンテナンスで試合がほぼ無いので単一境界で足りる。
   * 新パッチごとに1行追加する（配信日の 00:00Z を目安）。未登録の期間のレコードは
   * 最後のエントリに含まれる（= 最新パッチ扱い）ので、追加を忘れると新パッチが旧パッチに混ざる。
   *
   * Riot が game_version を直して実パッチ（例 "18.3"）が入るようになれば、v が "{set}.0"
   * でなくなるので、この表は使われず v がそのまま採用される。
   */
  patchSchedule: [
    { patch: '18.1', since: '2026-08-26T00:00:00Z' },
    { patch: '18.2', since: '2026-09-10T00:00:00Z' },
  ] as { patch: string; since: string }[],
}
