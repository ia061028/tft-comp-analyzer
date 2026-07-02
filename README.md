# TFT 紋章構成アナライザー

TFT（Teamfight Tactics）のプレイ支援用Webアプリ。Riot API から高ランク帯（Master以上）のランク戦績を収集・集計し、**紋章(emblem)を選ぶと、その紋章を活用している構成**を平均順位・Top4率・採用率などで提示する自分専用ツール。データ収集は GitHub Actions、配信は Cloudflare Pages（静的 `stats.json` を読むSPA）。

ライブ: https://tft-comp-analyzer.pages.dev/ ／ アーキテクチャの詳細は [ARCHITECTURE.md](ARCHITECTURE.md) を参照。

## 主な機能

- **紋章で絞り込み**: 紋章を選ぶと、その構成での**採用率**（その紋章を装備したゲームの割合）でフィルタ・並べ替え。複数選択時は OR（いずれかを使う構成）で表示しつつ、全部使う構成を上位に出す**活用度 N/K** バッジ付き。
- **ティア/平均順位**: 各構成に平均順位から算出した S/A/B/C/D ティアと、Top4率/1位率を表示。
- **発動シナジー**: その構成で過半数発動している特性を、発動ユニット数つきで表示（例: ブロウラー2 / チャレンジャー4）。
- **ユニット表示**: 代表ユニットを★（スター）・推奨完成アイテム・装備紋章つきで表示（metatft風）。
- **ユニット数で絞り込み**: 全体 / 盤面ユニット数7〜10で構成を出し分け（プレイヤーレベルではなく実際の盤面ユニット数）。
- **日英切替**: 特性/ユニット/紋章/アイテム名を日↔英でトグル。
- **チームコードのコピー**: クライアントのチームプランナーに貼れるコードを生成（※形式は検証中。下記「既知の課題」）。

## アーキテクチャ

```
collector/ (GitHub Actions, 6時間ごと)
  collect.ts        Riot API → data ブランチの records/{route}.ndjson（参加者1人=1レコード）に追記
  aggregate.ts       records → public/data/stats.json（集計I/O層）
  aggregate-core.ts  集計ロジック本体（純関数、テスト付き）
  cdragon.ts         Community Dragon から trait/unit/emblem/item 辞書（日英名・アイコン・プランナーcode）
src/ (Vite + React, Cloudflare Pages配信)
  stats.json を fetch して表示（クライアント側で再集計・絞り込み）
shared/types.ts  収集側とフロントの共有型（ParticipantRecord, StatsFile, CompStats ...）
```

集計の要点（データモデル v3、詳細は [ARCHITECTURE.md](ARCHITECTURE.md)）:
- 構成 = **盤面ユニット集合が完全一致するレコード群**（クラスタリングなし）。
- 召喚・非ショップユニットは盤面から除外しつつ特性寄与は記録し、紋章の活用判定（盤面実効特性数がブレークポイントちょうど=活用度+1、超過=+0.5）に反映する。
- 構成ごとに: 代表ユニット/★/推奨アイテム、紋章ごとの装備者(holders)、紋章活用シグネチャ(sigs) を集計。低nの構成は出力から枝刈り。

## セットアップ

```sh
npm install
cp .env.example .env   # RIOT_API_KEY を設定（https://developer.riotgames.com）
```

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | フロントエンド開発サーバー |
| `npm run build` | 本番ビルド（tsc -b + vite build） |
| `npm run lint` | ESLint |
| `npm test` | テスト（collector の aggregate-core/patches/state、src の multiset/format/i18n） |
| `npm run collect` | Riot API からマッチ収集 → `data/state/` に追記（`.env` のキー使用） |
| `npm run aggregate` | `data/state/` → `public/data/stats.json` 集計 |
| `npm run data:pull` | `data/state` を orphan ブランチ `data` の最新スナップショットに同期 |

## データ運用

収集状態（records/seen/meta）の正本は main とは別の **orphan ブランチ `data`**。main には一切コミットされない。詳細は [ARCHITECTURE.md](ARCHITECTURE.md) を参照。

- **CI 収集**: `.github/workflows/collect.yml` が6時間ごとに collect→aggregate→data ブランチへ squash force-push→（実質差分があれば）stats.json を main へコミット。Cloudflare Pages が push で自動再デプロイ。
- **キー失効 = no-op**: collect は冒頭の認証プリフライトで 401/403 を検出すると `status=auth_expired` を出して exit 0（state 不変）。この場合 aggregate・data ブランチ push・stats.json コミットは全てスキップされ、コミット0・デプロイ0。スティッキー issue（ラベル `riot-key`）が起票され（初回のみ通知、以後は本文編集のみ）、キー復旧後の次回実行で自動クローズされる。実際のルート例外時のみジョブが赤失敗する。
- **APIキー**: CI が使うのは **GitHubリポジトリ Secret `RIOT_API_KEY`**（ローカル `.env` ではない）。開発キーは**24時間で失効**するので、上記の no-op パスに入る。`gh secret set RIOT_API_KEY --body "RGAPI-..."`（パイプ流し込みは BOM/改行混入の恐れがあるため `--body`）または Settings→Secrets→Actions で更新。恒久対応は**本番APIキー**への切替。
- **ローカルでの収集状態同期**: 初回は `git clone --depth 1 --branch data https://github.com/ia061028/tft-comp-analyzer.git data/state`、以後は `npm run data:pull`。
- 手動収集: ローカルで有効な `.env` と `data/state` があれば `npm run collect && npm run aggregate` で更新可能（main へのコミットは別途）。

## 既知の課題 / TODO

- **チームコードの形式**: 現行は `02` + 各チャンピオン12bit(3桁hex, team_planner_code) + `TFTSet{n}`。実機での有効性は要再検証（クライアント生成コードとの突き合わせ）。
- **本番APIキー**: 取得後に Secret 差替え＋`config.enableDiamond=true` で Diamond 帯収集も有効化可能（現状は dev キーのレート上限回避で off）。
