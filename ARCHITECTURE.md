# アーキテクチャ

TFT紋章構成アナライザーの実装アーキテクチャ。設計判断の背景と現状のデータフローをまとめる。

## 概要

- **スタック**: React 19 + Vite 8 + Tailwind v4 + TypeScript。ビルド成果物は純粋な静的SPA。
- **配信**: Cloudflare Pages が `main` への push を検知して自動ビルド・配信（https://tft-comp-analyzer.pages.dev/）。サーバーサイドは一切持たない。
- **データ収集**: GitHub Actions（`cron 17 */6 * * *` + `workflow_dispatch`）。Riot API から Challenger / GM / Master（設定で Diamond も追加可）の TFT ランクマッチを収集する。
- **フロントの役割**: ビルド済みの `public/data/stats.json` を実行時 fetch し、クライアント側で紋章選択に応じた再集計・フィルタ・並べ替えを行う。バックエンドAPIは無い。

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
      │  records/{route}.ndjson            │
      │  seen/{route}.ndjson               │
      │  meta.json                         │
      └───────────────┬────────────────────┘
                         │ squash force-push 後に読み出し
                         ▼
                ┌──────────────────┐
                │  aggregate.ts /   │  collector/aggregate-core.ts（純関数）
                │  aggregate-core   │
                └───────┬───────────┘
                         │ 実質差分がある時だけ
                         ▼
          public/data/stats.json（main へコミット）
                         │
                         ▼
                ┌──────────────────┐
                │  Cloudflare Pages  │  main への push を検知して自動ビルド・配信
                └───────┬───────────┘
                         ▼
              https://tft-comp-analyzer.pages.dev/
              （src/lib/data.ts が実行時 fetch）
```

collect と aggregate は同じ CI ジョブ内で直列に実行されるが、**状態の持ち先が違う**点が肝。records/seen は `data` ブランチ、集計結果の `stats.json` だけが `main` に乗る。

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

1. **パッチ（`v`）**: `pickTargetPatch` が「ユニークマッチ数 >= `patchSwitchThreshold` の最新パッチ」を選ぶ（ヒステリシス）。新セットが別パッチで始まる通常ケースはこれで足りる。
2. **セット番号（`s` = `tft_set_number`）**: 対象パッチ内でさらに最頻セットに絞る（`pickTargetSet`）。`s` を持たない旧レコードは残す。同一 `game_version` 内でセットが切り替わる場合にパッチだけでは分離できないため、一次情報として記録している。

なお `config.tftPatchLabels`（内部パッチキー → TFT 表記）は計算で導けない手動マップ。未登録のときは内部パッチをそのまま表示し、aggregate が警告を出す。新パッチ・新セットでは collect ログの「パッチ×セット（新規分）」で実値を確認して1行追加する。

### ローリング窓（prune ポリシー）

収集レコードは `data` ブランチの `records/{route}.ndjson` に追記され、collect の末尾で prune される。GitHub のハード上限が **100MB/ファイル**なので、サンプル数の天井はここで決まる（実測 約900バイト/レコード、1マッチ8参加者＝約7.2KB/マッチ）。

prune は2段階（`filterNdjsonForWindow`）:

1. **旧セットの切り捨て**: `s`(tft_set_number) を持つ行が1件でもあれば、最大の `s` 以外を落とす。`s` を持たない旧形式レコード（セット17以前）もここで落ちる。`s` を持つ行が皆無なら何もしない（全消し防止のガード）。
2. **窓あふれの切り捨て**: 残りが `config.maxRecordsPerRoute`（90,000 ≒ 81MB ≒ 約11,250マッチ）を超えたら、マッチ単位で新しい順に保持し、はみ出したマッチを丸ごと落とす。マッチを分断しないのは、8参加者が揃っていないと `totals.matches` が実態とずれるため。

パース不能行は常に保持し、窓の予算からも除外する（安全側）。出力は元の行順を維持する（append-only に近い形を保ち git のデルタ圧縮を効かせるため）。1行も落ちなければファイルに触らない。

**パッチ単位の prune は廃止した**（旧 `patchesToKeep`）。Unreal 移行後は `game_version` が使えず全レコードが単一パッチキー（`{set}.0`）に潰れるため、「上位2パッチを保持」では旧セットが永久に残ってしまう。セットと新しさで切るのが正しい。

定常状態のサンプルは 4ルート × 約11,250マッチ = **約45,000マッチ**。6時間ごとの実行で約2日かけて窓が埋まり、以後は常に最新のマッチで置き換わる。

### 母集団（puuid プール）

Challenger / Grandmaster / Master に加え、`config.entryTiers`（DIAMOND〜IRON）を entries エンドポイントからティア×ディビジョンごとに抽選する。高レート帯だけでは母集団が枯れるため（セット18開始3日目の実測で全15プラットフォームの Challenger/GM が 0人、Master が計30人）。

リーグ一覧はプラットフォームホスト（`kr.api` 等）、マッチ取得はリージョナルホスト（`asia.api` 等）で、**レート枠が別**。よって母集団を広げるコストはマッチ取得の予算を食わない。

律速はリージョナルホストのレート上限（開発キーで `100req/120s` = 50req/分）。4ルート並列・収集30分で **約6,000マッチ/ラン**が理論上限で、`maxNewMatchesPerRoutePerRun: 1500` はこれに合わせてある。

なお全ティアを対象にしているので、統計は「高レートの最適解」ではなく**その帯で実際に組まれた構成の分布**を表す。

### 実装の分離

- **`collector/aggregate-core.ts`**: 集計ロジック本体。`fs` / `fetch` / `process` / `console` に依存しない純関数群（`splitBoardUnits`, `classifyEmblems`, `pickTargetSet`, `buildStats` など）。テスト（`*.test.ts`）はここに対して書く。
- **`collector/cdragon.ts`**: CDragon 取得の I/O 層。ただし紋章判定（`isEmblemItemLoose`, `resolveEmblemTraits`, `classifyBase`, `emblemIconRe`）はネットワーク非依存の純関数として export しており、`cdragon.test.ts` がここを直接テストする。
- **`collector/collect.ts`**: 収集の I/O 層。末尾にエントリガード（`process.argv[1]` と `import.meta.url` の一致判定）があり、テストから `buildRecords` を import しても収集は走らない。
- **`collector/aggregate.ts`**: I/O 層。`data/state/records/*.ndjson` の読み込み、CDragon 静的データの取得、`aggregate-core.ts` の呼び出し、`public/data/stats.json` への書き出しを担当。

## CI フローとキー失効 no-op 設計

開発用 Riot API キーは短時間で失効することが常態のため、**「キー失効 = 完全 no-op」を既定パスとして設計**している（`.github/workflows/collect.yml`）。

```
collect（認証プリフライト）
  ├─ 401/403 検出 → status=auth_expired を出力して exit 0
  │     └─ 後続の aggregate / data ブランチ push / stats.json コミットを全てスキップ
  │        （コミット0・デプロイ0。state にも一切触れない）
  ├─ 成功 → status=ok, new_records=<件数> を出力
  │     └─ aggregate → data ブランチへ squash force-push → stats.json に実質差分があれば main へコミット
  └─ 実エラー（ルート例外） → status を出さず exit 1 → ジョブが赤失敗
```

- **通知**: キー失効時はスティッキー issue（ラベル `riot-key`）を使う。既に open な issue があれば本文を編集するだけ（通知なし）、無ければ新規作成（初回のみ通知）。これにより「6時間ごとに失効通知が飛び続ける」事態を避けつつ、失効状態は issue の存在で可視化される。
- **復旧**: キー更新後の次回実行で `status=ok` になったら、open な `riot-key` issue を自動クローズする。
- **stats.json のコミット判定**: `aggregate.ts` は決定的な出力を生成するため、`generatedAt` 以外の実質差分が無ければ `stats.json` を書き換えない。CI 側は `git diff --quiet` で確認し、差分が無ければコミット・pushをスキップする（＝Cloudflare Pages の無駄な再デプロイを防ぐ）。

## data ブランチ運用

収集状態（records・seen・meta）の正本は **orphan ブランチ `data`**。ルート直下に以下を持つ:

```
records/{route}.ndjson   参加者1人=1レコード（追記）
seen/{route}.ndjson      処理済みマッチID（重複取得防止）
meta.json                収集メタ情報
```

CI は `actions/checkout@v4`（`ref: data`, `path: data/state`）で `data` ブランチを `data/state` に独立チェックアウトする。main 側の `.gitignore` は `/data/`（先頭 `/` でリポジトリ直下限定、`public/data` は対象外）を無視するため、この入れ子チェックアウトは main の git 操作に一切干渉しない。

収集が成功した回だけ、`data/state` 内で `git checkout --orphan snapshot` → `git add -A` → `git commit` → `git push --force origin snapshot:data` を行う。**履歴は常に1コミットのスナップショット**になる。

### なぜ orphan + squash force-push か

- records/seen は追記専用の NDJSON で、6時間ごとに更新され続ける。通常のコミット履歴を積むと、パッチが変わるたびに肥大化した履歴がリポジトリに残り続ける。
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
