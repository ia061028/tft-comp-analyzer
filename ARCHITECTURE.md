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

Riot の `num_units`（トレイトごとの発動ユニット数）には、導き手などで盤面に追加される召喚・非ショップユニット（`NON_BOARD_UNIT_RE` = `_Summon$|Minion|PVE|Enemy_|TrainingDummy` にマッチするもの）も含まれる。これらは:

- **構成キー（盤面ユニット集合）からは除外**する。プレイヤーが実際に編成したユニットのみを構成として扱うため。
- ただし**特性寄与は記録**する（`summonTraitCount`）。紋章の活用判定で「盤面実効特性数 = Riot `num_units` − 召喚ユニットの当該特性寄与」を使うことで、召喚ユニットだけでブレークポイントに達しているケースを誤って「活用」と数えないようにする。

### 紋章活用シグネチャ（sig）

紋章を装備しているだけでなく、実際にその紋章の特性を発動に活かしているかを判定する:

- **one（+1）**: 盤面実効特性数がちょうどブレークポイント（発動しきい値）と一致する場合。
- **half（+0.5）**: 盤面実効特性数がブレークポイントを超過している場合（紋章がなくても発動していた）。
- 盤面実効特性数が最小ブレークポイント未満、または召喚ユニットのみでの発動は「活用」に数えない。
- `rec.tc`（トレイト→num_units のマップ）が欠落している旧形式レコードはシグネチャ集計から除外し、診断カウンタ（`tcMissingRecords`）に計上する。

### 実装の分離

- **`collector/aggregate-core.ts`**: 集計ロジック本体。`fs` / `fetch` / `process` / `console` に依存しない純関数群（`splitBoardUnits`, `classifyEmblems`, `buildStats` など）。テスト（`*.test.ts`）はここに対して書く。
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
