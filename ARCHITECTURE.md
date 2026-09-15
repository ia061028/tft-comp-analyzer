# アーキテクチャ

TFT紋章構成アナライザーの実装アーキテクチャ。設計判断の背景と現状のデータフローをまとめる。

## 概要

- **スタック**: React 19 + Vite 8 + Tailwind v4 + TypeScript。ビルド成果物は純粋な静的SPA。
- **配信**: Cloudflare Pages が `main` への push を検知して自動ビルド・配信（https://tft-comp-analyzer.pages.dev/）。サーバーサイドは一切持たない。
- **データ収集**: GitHub Actions（`cron 17 */6 * * *` + `workflow_dispatch`）。Riot API から Challenger / GM / Master（設定で Diamond も追加可）の TFT ランクマッチを収集する。
- **フロントの役割**: ビルド済みの `public/data/stats.json` を実行時 fetch し、クライアント側で紋章選択に応じた再集計・フィルタ・並べ替えを行う。パッチを切り替えると同ディレクトリの `stats-{patch}.json` を追加 fetch する。バックエンドAPIは無い。

## データフロー

```
                 ┌───────────────┐
                 │   Riot API     │
                 └───────┬────────┘
                         │ league/match 取得（GitHub Actions, 6時間ごと）
                         ▼
                ┌──────────────────┐
                │   collect.ts      │  認証プリフライト（401/403 → no-op）
                └───────┬───────────┘
                         │ 参加者レコードを追記
                         ▼
      ┌───────────────────────────────────┐
      │  data ブランチ（orphan, 正本）       │
      │  records/{route}.ndjson  (アクティブ)│
      │  records/{route}/*.ndjson.gz (封印) │
      │  seen/{route}.ndjson               │
      │  meta.json                         │
      └───────────────┬────────────────────┘
                         │ squash force-push 後に読み出し
                         ▼
                ┌──────────────────┐
                │  aggregate.ts /   │  collector/aggregate-core.ts（純関数）
                │  aggregate-core   │  ストリーミング3パス（全件をメモリに持たない）
                └───────┬───────────┘
                         │ 実質差分がある時だけ
                         ▼
          public/data/stats.json ＋ stats-{patch}.json（main へコミット）
                         │
                         ▼
                ┌──────────────────┐
                │  Cloudflare Pages  │  main への push を検知して自動ビルド・配信
                └───────┬───────────┘
                         ▼
              https://tft-comp-analyzer.pages.dev/
              （src/lib/data.ts が実行時 fetch）
```

collect と aggregate は同じ CI ジョブ内で直列に実行されるが、**状態の持ち先が違う**点が肝。records/seen は `data` ブランチ、集計結果の `public/data/`（`stats.json` とパッチ別ファイル）だけが `main` に乗る。

## データモデル v3

構成（comp）の定義は「**盤面ユニット集合が完全一致するレコード群**」。かつてのシナジークラスタリング（発動中の上位2特性でグルーピング）は廃止し、盤面ユニットそのものをキーにしている。

### 召喚ユニットの扱い

導き手などで盤面に追加される召喚・非ショップユニット（`NON_BOARD_UNIT_RE` = `_Summon$|Minion|PVE|Enemy_|TrainingDummy` にマッチするもの）と、コスト1-5 の範囲外のユニットは、**構成キー（盤面ユニット集合）から除外**する（`splitBoardUnits`）。プレイヤーが実際に編成したユニットのみを構成として扱うため。

この判定は apiName の命名規約に依存するので、新セットでは実データで取りこぼしを確認すること（診断の「未解決ユニット」警告と、構成の盤面ユニット数がプレイヤーレベルと整合するか）。

`rec.tc`（トレイト→`num_units`）は収集しているが、現在の集計では使っていない（将来の効率分析用）。

### 紋章活用シグネチャ（sig）

構成（盤面ユニット集合）の中を、**「その試合で実際に活用された紋章の組み合わせ」**でさらに分割したものが sig。Wire 上は `WireComp.g = [活用紋章idx[], n, top4, win, p]` の配列。

「活用」の定義は**二値**（`classifyEmblems`）:

- 装備している **AND** その紋章が付与するトレイト（変種を含むいずれか）が発動している（`rec.t` に存在する）。
- 発動数がブレークポイントちょうどか超過か（＝紋章が余っているか）は区別しない。要件が「その紋章を使ったシナジーが1つでも発動していれば対象」であり、余りの区別は要求されていないため。
- 同一紋章を複数装備した場合は `rec.e` の並びをそのまま辿るので多重度が保たれる。
- レコード上の紋章 apiName は `staticData.emblemAliases` で canonical に正規化してから解決する（下記「紋章の解決」）。

### 紋章の解決（セット非依存）

紋章 apiName はセット固有で不規則なため、名前の正規表現マッチだけに頼らない。`resolveEmblemTraits`（`collector/cdragon.ts`）が2段階で解決する:

1. **一次: `incompatibleTraits`**。紋章は「装備者にトレイトを付与する」アイテムで、その付与トレイトは同トレイト重複防止のため `incompatibleTraits` に記載される。apiName 完全一致 → 表示名一致 の順で選定セットのトレイトへ解決する。`associatedTraits` はオーグメントや Anima Squad 系アイテムにも付くため紋章判定には使えない。
2. **フォールバック: アイコンパス＋表示名**。一次が0件のときのみ、`item_icons/traits/<base>/set<N>/` 配下にあり表示名が `"<トレイト名> Emblem"` のアイテムを表示名から解決する。セット18 は CDragon 上 `incompatibleTraits` が空で配信されるため、これが無いと紋章が1件も検出されない。
   **セット限定のアイコンパスで絞るのは必須**で、外すと旧セットの同名紋章（例: セット3 の "Elderwood Emblem"）が新セットの同名トレイトへ誤マッチする。

付随して:

- **合成素材の分類**（`classifyBase`）は末尾一致（`_Spatula$` / `_FryingPan$`）で行う。接頭辞はセットで変わる（セット17 `TFT_Item_Spatula` → セット18 `DA_Component_Spatula`）。カテゴリヘッダ用の `baseItemIcons` も、選定セットの紋章 composition に実際に現れた素材から引く。
- **重複紋章の統合**: 同一トレイトを付与する紋章が複数配信される場合（セット18 の Flora Fatalis は通常版とオーグメント版の2件）、canonical を1件だけ辞書に載せ、残りは `emblemAliases` に入れて集計時に寄せる。canonical は「合成レシピを持つ方」優先、同条件なら CDragon の `items` 配列の出現順で先勝ち。
- **収集側**（`getEmblemContext`）はセット番号を持たないため、全セット横断の緩いゲート（`isEmblemItemLoose`: `incompatibleTraits` 非空 **または** アイコン置き場＋`" Emblem"` 名）を使う。records は生の apiName を保存しセット絞り込みは集計側が行うので過剰包含は無害だが、取りこぼすと収集し直しが効かないため意図的に緩くしている。

### セットの判別と切り替え

セット番号は決め打ちしない。`getStaticData` が `setData` の中から**集計対象レコードのトレイト apiName 集合との交差が最大**のセットを選ぶ（同数なら `number` が大きい方）。したがって新セットのレコードが集計対象になれば、辞書・日本語名・プランナーコードは自動で追従する。

セット境界の分離は2段構え:

1. **セット番号（`s` = `tft_set_number`）**: 最頻セットに絞る（`pickTargetSet`）。`s` を持たない旧レコードは残す。同一 `game_version` 内でセットが切り替わる場合にパッチだけでは分離できないため、一次情報として記録している。
2. **パッチ（`v`）**: 対象セット内でパッチごとに集計ビューを作る（次節）。既定ビューは `pickTargetPatch` が「ユニークマッチ数 >= `patchSwitchThreshold` の最新パッチ」を選ぶ（ヒステリシス）。

なお `config.tftPatchLabels`（内部パッチキー → TFT 表記）は計算で導けない手動マップ。未登録のときは内部パッチをそのまま表示し、aggregate が警告を出す。`patchSchedule` 由来のキー（次節）は TFT 表記そのものなので登録不要。

### パッチの割り当てとパッチ別ビュー

**パッチは試合日時で割り当てる。** セット18（Unreal 移行）以降、Riot の `game_version` は `"TFT Unreal Version ?.?.?.?"` というプレースホルダでパッチ番号を返さない。collect は `tft_set_number` から `"{set}.0"` を合成して `v` に入れ、aggregate が各レコードの `ts`（game_datetime）を `config.patchSchedule`（`{ patch, since }` の配信日時表）に当てて実パッチ（`18.1` / `18.2` …）へ置き換える（`resolvePatch`）。

- `v` が実パッチ（minor ≠ 0）ならスケジュールを見ずそのまま使う。Riot が `game_version` を直した時に自然に切り替わるため。
- 境界は単一の UTC 時刻。実際の配信はリージョンごとに数時間ずれる（OCE→KR→EU→NA）が、配信前後はメンテナンスで試合がほぼ無いので実用上は足りる。
- **運用**: 新パッチが配信されたら `config.patchSchedule` に1行追加する。忘れると新パッチの試合が最後のエントリ（旧パッチ）に混ざる。

**出力はビューごとに1ファイル**（`planPatchViews`）:

| ビュー | 条件 | ファイル |
|---|---|---|
| 既定パッチ | `pickTargetPatch` のヒステリシス選定 | `public/data/stats.json` |
| 各パッチ | ユニークマッチ数 >= `patchSwitchThreshold` | `public/data/stats-{patch}.json` |
| 全パッチ合算 `all` | 単独ビューが2つ以上あるときだけ | `public/data/stats-all.json` |

全ファイルは同じスキーマ（`WireStatsFile`）で、`patches` に同一の一覧（`key` / `label` / `file` / `matches`）を埋め込む。フロントは最初に `stats.json` を読み、その `patches` からセグメントコントロールを作り、選択に応じて該当ファイルを fetch してメモリにキャッシュする。紋章の intern（`emblems` 配列）はファイルごとに「レコードに現れた紋章」だけなのでインデックスが変わりうる。切替時は選択中の紋章を apiName 経由で新ファイルのインデックスへ写す（`remapSelection`）。

パッチが保持窓から消えれば、そのビューは次回の aggregate で生成されず、aggregate が旧 `stats-*.json` を削除する（CI は `public/data` をディレクトリごと `git add -A` する）。

**出力サイズの歯止め**: 1ビューの構成数は `config.maxCompsPerView`（既定 20,000。n 降順・同数は盤面キー昇順で決定的に切る）で抑える。1構成約260バイトなので約5MB/ビュー。辞書（traits/units/emblems/items）のインターンは生き残った構成だけを対象にする。`MIN_OUTPUT_N = 3` は据え置き。

### ストリーミング集計（3パス）

保持レコードが数百万件になるため、aggregate は全件をメモリに展開しない。`shards.ts` の `forEachRecord` で封印シャード（gunzip）→ アクティブの順に1件ずつ読み、3回なめる:

1. **パス A（走査）**: `resolvePatch` でパッチを割り当て、セット分布・(セット, パッチ) ごとのユニークマッチ・トレイト名集合を取る。ここから対象セット（`pickTargetSetFromCounts`）、保持下限パッチ（`retentionFloor`）、ビュー（`planPatchViews`）を決め、静的データを1回だけ解決する。
2. **パス B（盤面カウント）**: 対象レコード（対象セット かつ floor 以上）を `classifyRecord` し、構成キー → パッチ別件数を数える。
3. **パス C（集計）**: ビューごとの `createStatsBuilder` に取り込む。`boardFilter` でそのビュー内の n >= `MIN_OUTPUT_N` の盤面だけアキュムレータを作る（盤面の約9割は n<3 で最終的に落ちるので、これが無いとメモリが数倍になる）。

`buildStats(target[])` は builder を配列で回す薄いラッパとして残しており、テストのゴールデンはそのまま。実測（48万レコード）: パス A 5秒・B 7秒・C 15秒、ピークヒープ約380MB。CI は `NODE_OPTIONS=--max-old-space-size=4096` で実行する。

### 保持ポリシー（シャード化＋パッチ窓）

収集レコードは `data` ブランチの `records/` に置く。GitHub のハード上限（**100MB/ファイル**、非圧縮 blob）を1ファイルの分割と gzip で回避し、保持量はパッチ窓と容量予算で決める。

```
records/{route}.ndjson                                       アクティブシャード: 生 NDJSON、追記専用、書き換えない
records/{route}/000001_s18_1787702400-1788867459.ndjson.gz   封印シャード: 不変（seq 6桁_s{set}_{minTs}-{maxTs}）
```

- **封印**（`shards.ts` `sealActiveShard`）: collect の末尾（と `npm run data:seal`）で、アクティブが `config.sealThresholdBytes`（64MB）を超えていれば丸ごと gzip して封印シャードにし、アクティブを消す。封印シャードは最大でも閾値＋1ラン分で 100MB に当たらない。gzip は実測約 1/10（88MB → 8.5MB）。ファイル名が自己記述（セット・ts 範囲）なので索引ファイルは持たない。
- **保持**（`retention.ts` `planRetention`。封印シャード単位で削除するだけで、レコード単位の書き換えはしない）:
  1. 現行セット（最大の `s`）以外は落とす（`old-set`）。
  2. 最新レコード（maxTs）のパッチが保持下限パッチ（floor）より古いシャードは落とす（`old-patch`）。floor は `retentionFloor`: `config.patchSchedule` のうち配信済みエントリの末尾 `config.patchesToKeep`（2）件の先頭。境界をまたぐシャードは最新レコードが窓外になるまで残す（その間の旧パッチレコードは aggregate 側の同じ規則で出力から除外する）。
  3. 残りの gz 合計が `config.maxSealedBytesPerRoute`（64MB ≒ 約10万マッチ/ルート ≒ パッチ約2本分）を超えたら古い seq から落とす（`byte-cap`）。**定常時に実際に効くのはこの規則**で、現パッチが増えるにつれ前パッチのシャードが古い順に押し出される。アクティブは予算に数えない。
- **取得窓**: collect のマッチ ID 取得の下限時刻（`collectStartTime`）は「セット開始」と「配信済みの直近 `config.collectPatchesBack`（1）パッチの配信開始」の遅い方。つまり**最新パッチの試合しか新たに取りに行かない**（前パッチのレコードは保持窓の中に残るが、バックフィルはしない）。新パッチ配信後に `patchSchedule` へ追加するまでは前パッチの配信開始が下限なので、新パッチの試合を取りこぼすことはない。
- **seen**（処理済みマッチID）はセット1本分だけ持つ。`meta.collectSince` が `config.collectSinceEpoch` と異なれば（＝セット切替）空にする。旧レイアウト（`collectSince` 無し）では現値を採用するだけでリセットしない。
- **`.gitattributes`**: collect が `data/state/.gitattributes` に `*.gz binary` を含む内容を書く（CI の push は `git add -A`）。gz を text 扱いにすると Windows で CRLF 変換されて壊れる。

旧レイアウト（`records/{route}.ndjson` のみ）は「封印シャード0個のアクティブ」として読めるので、移行手順は無い。最初のランの末尾でアクティブが閾値超えで封印され、以後は新レイアウトになる。

定常状態のサンプルは 4ルート × 約10万マッチ = **約40万マッチ**（母集団を Master 以上に絞った後の流入は1日5,000〜10,000試合なので、予算に達するまで1〜2か月。それまでは「直近2パッチ」の上限規則が先に効く）。

### 母集団（puuid プール）

全15プラットフォームの Challenger / Grandmaster / Master を**全員**プールに入れる（抽選しない）。ルート内の Master 以上の合計が `config.minHighTierPoolPerRoute`（500人）未満のときだけ、`config.entryTiers`（DIAMOND〜IRON）を entries エンドポイントからティア×ディビジョンごとに取って補充する（フォールバック。セット開始直後は全15プラットフォームで Challenger/GM が 0人、Master 計30人だった）。どちらのモードで動いたかはログに出る。プールが `config.maxPoolPerRoute`（6,000）を超えたら間引く。

2026-09-12 の実測: Master 以上は americas 1,132 / asia 1,703 / europe 1,365 / sea 4,292 人。以前は Diamond 以下を常に混ぜ、Master を 100人/プラットフォームに間引いていたため、プールの8〜9割が Diamond 以下だった。

リーグ一覧はプラットフォームホスト（`kr.api` 等）、マッチ取得はリージョナルホスト（`asia.api` 等）で、**レート枠が別**。よって母集団の広さはマッチ取得の予算を食わない。

レコードには参加者のティアを持たないので、母集団を変えても過去のレコードを遡って絞ることはできない（保持窓から押し出されるまで残る）。

### 実装の分離

- **`collector/aggregate-core.ts`**: 集計ロジック本体。`fs` / `fetch` / `process` / `console` に依存しない純関数群（`splitBoardUnits`, `classifyEmblems`, `classifyRecord`, `pickTargetSetFromCounts`, `createStatsBuilder`, `buildStats` など）。テスト（`*.test.ts`）はここに対して書く。
- **`collector/cdragon.ts`**: CDragon 取得の I/O 層。ただし紋章判定（`isEmblemItemLoose`, `resolveEmblemTraits`, `classifyBase`, `emblemIconRe`）はネットワーク非依存の純関数として export しており、`cdragon.test.ts` がここを直接テストする。
- **`collector/collect.ts`**: 収集の I/O 層。末尾にエントリガード（`process.argv[1]` と `import.meta.url` の一致判定）があり、テストから `buildRecords` を import しても収集は走らない。
- **`collector/patches.ts`**: パッチ比較（`compareVersions`）、既定パッチのヒステリシス選定（`pickTargetPatch`）、日時ベースのパッチ割り当て（`resolvePatch`）、出力ビュー選定（`planPatchViews`）、保持下限パッチ（`retentionFloor`）。全て純関数で `patches.test.ts` / `retention.test.ts` が対象。
- **`collector/retention.ts`**: 封印シャードの命名（`shardFileName` / `parseShardFile`）と保持計画（`planRetention`）。純関数。
- **`collector/shards.ts`**: シャード I/O。一覧（`listRouteShards`）、ストリーム読み（`forEachRecord`）、封印（`sealActiveShard`）、保持適用（`sealAndPrune`）。`recordsDir` を引数に取り、`shards.test.ts` は一時ディレクトリで実行する。
- **`collector/aggregate.ts`**: I/O 層。シャードのストリーミング読み、CDragon 静的データの取得、ビューごとの `createStatsBuilder` 呼び出し、`public/data/stats.json` / `stats-{patch}.json` への書き出し（実質差分のないファイルは触らず、不要になった旧ファイルは削除）を担当。
- **`collector/seal.ts`**: `npm run data:seal`。収集せずに封印と保持適用だけを行う（ローカルの移行確認・手動封印用。Riot キー不要）。

## CI フローとキー失効 no-op 設計

開発用 Riot API キーは短時間で失効することが常態のため、**「キー失効 = 完全 no-op」を既定パスとして設計**している（`.github/workflows/collect.yml`）。

```
collect（認証プリフライト）
  ├─ 401/403 検出 → status=auth_expired を出力して exit 0
  │     └─ 後続の aggregate / data ブランチ push / public/data コミットを全てスキップ
  │        （コミット0・デプロイ0。state にも一切触れない）
  ├─ 成功 → status=ok, new_records=<件数> を出力
  │     └─ 封印/保持適用 → aggregate → data ブランチへ squash force-push → public/data に実質差分があれば main へコミット
  └─ 実エラー（ルート例外） → status を出さず exit 1 → ジョブが赤失敗
```

- **通知**: キー失効時はスティッキー issue（ラベル `riot-key`）を使う。既に open な issue があれば本文を編集するだけ（通知なし）、無ければ新規作成（初回のみ通知）。これにより「6時間ごとに失効通知が飛び続ける」事態を避けつつ、失効状態は issue の存在で可視化される。
- **復旧**: キー更新後の次回実行で `status=ok` になったら、open な `riot-key` issue を自動クローズする。
- **public/data のコミット判定**: `aggregate.ts` は決定的な出力を生成するため、`generatedAt` 以外の実質差分が無いファイルは書き換えない。CI 側は `public/data` ディレクトリの `git diff --quiet` と未追跡ファイルの有無で確認し、差分が無ければコミット・pushをスキップする（＝Cloudflare Pages の無駄な再デプロイを防ぐ）。ファイルの追加・削除（パッチの出現・窓からの退出）も同じ判定に乗る。

## data ブランチ運用

収集状態（records・seen・meta）の正本は **orphan ブランチ `data`**。ルート直下に以下を持つ:

```
.gitattributes                    collect が書く（*.ndjson/*.json は LF、*.gz は binary）
records/{route}.ndjson            アクティブシャード（参加者1人=1レコード、追記）
records/{route}/*.ndjson.gz       封印シャード（不変。「保持ポリシー」参照）
seen/{route}.ndjson               処理済みマッチID（重複取得防止。セット切替でリセット）
meta.json                         収集メタ情報（routes, collectSince）
```

CI は `actions/checkout@v5`（`ref: data`, `path: data/state`）で `data` ブランチを `data/state` に独立チェックアウトする。main 側の `.gitignore` は `/data/`（先頭 `/` でリポジトリ直下限定、`public/data` は対象外）を無視するため、この入れ子チェックアウトは main の git 操作に一切干渉しない。

収集が成功した回だけ、`data/state` 内で `git checkout --orphan snapshot` → `git add -A` → `git commit` → `git push --force origin snapshot:data` を行う。**履歴は常に1コミットのスナップショット**になる。

### なぜ orphan + squash force-push か

- records/seen は追記専用の NDJSON で、6時間ごとに更新され続ける。通常のコミット履歴を積むと、パッチが変わるたびに肥大化した履歴がリポジトリに残り続ける。
- 封印シャードは不変なので、force-push でも git は同一 blob を再送しない。1ランで転送されるのは変更のあったアクティブシャード（生 NDJSON、zlib 圧縮で約1/10）と seen だけ。
- 復旧・再現に必要なのは「今の状態」だけで、収集データの変更履歴に価値は無い。squash force-push なら常に1コミットに保たれ、リポジトリサイズが線形に増えない。
- main の履歴と分離することで、`git clone` 時に `main` だけを浅く取得すればアプリのソースは揃う（records の重量はビルド・デプロイに一切関係しない）。

なお、2026-07-02 に `git filter-repo` で main 履歴から旧世代の `data/state` コミットと `stats.json` の旧世代を除去済み（69MB→約10MB）。

## ローカル開発

初回セットアップ:

```sh
npm install
cp .env.example .env   # RIOT_API_KEY を設定
git clone --depth 1 --branch data https://github.com/ia061028/tft-comp-analyzer.git data/state
```

以後、収集状態を最新化する場合:

```sh
npm run data:pull   # data/state を origin/data の最新スナップショットに同期
npm run data:seal   # 収集せずに封印と保持適用だけ行う（移行確認・手動封印。キー不要）
```

`data:pull`（`collector/data-pull.ts`）は `data/state` が独立した git チェックアウトであることを検証してから `reset --hard` する。検証を省くと、`data/state` がただのディレクトリだった場合に git が親（main リポジトリ）の `.git` を辿ってしまい、main の作業ツリー全体を `origin/data` へ hard reset して壊す危険があるため。独立チェックアウトでない場合はエラーで停止し、初回セットアップの `git clone` を促す。

## キー運用

- CI が使うのは **GitHub リポジトリ Secret `RIOT_API_KEY`**（ローカル `.env` とは別）。更新は:
  ```sh
  gh secret set RIOT_API_KEY --body "RGAPI-..."
  ```
  （パイプ流し込みは PowerShell 5.1 環境で BOM/改行混入の恐れがあるため `--body` を使う。）
- 開発キーは24時間で失効する。失効時は上記の no-op パスに入り、スティッキー issue で可視化される。
- Riot の Personal/Production キー承認は**ゲーム単位スコープ**。LoL 承認済みキーは TFT では 403 になるため、TFT 対応の開発キーか TFT 個別承認が必要。
- 本番（TFT対応）APIキー承認後は `collector/config.ts` の `enableDiamond` を `true` にすると Diamond 帯の収集も有効化できる（現状は dev キーのレート上限回避のため false）。
