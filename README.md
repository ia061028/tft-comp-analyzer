# TFT 紋章構成アナライザー

TFT（Teamfight Tactics）のプレイ支援用Webアプリ。Riot API から高ランク帯（Master以上）のランク戦績を収集・集計し、**紋章(emblem)を選ぶと、その紋章を活用している構成**を平均順位・Top4率・採用率などで提示する自分専用ツール。データ収集は GitHub Actions、配信は Netlify（静的 `stats.json` を読むSPA）。

ライブ: https://tft-comp-analyzer.netlify.app/ ／ 初期設計は [PLAN.md](PLAN.md) を参照。

## 主な機能

- **紋章で絞り込み**: 紋章を選ぶと、その構成での**採用率**（その紋章を装備したゲームの割合）でフィルタ・並べ替え。複数選択時は OR（いずれかを使う構成）で表示しつつ、全部使う構成を上位に出す**活用度 N/K** バッジ付き。
- **ティア/平均順位**: 各構成に平均順位から算出した S/A/B/C/D ティアと、Top4率/1位率を表示。
- **発動シナジー**: その構成で過半数発動している特性を、発動ユニット数つきで表示（例: ブロウラー2 / チャレンジャー4）。
- **ユニット表示**: 代表ユニットを★（スター）・推奨完成アイテム・装備紋章つきで表示（metatft風）。
- **レベル別**: 全体 / Lv7〜10 で構成を出し分け（レベルで構成が変わる）。
- **日英切替**: 特性/ユニット/紋章/アイテム名を日↔英でトグル。
- **チームコードのコピー**: クライアントのチームプランナーに貼れるコードを生成（※形式は検証中。下記「既知の課題」）。

## アーキテクチャ

```
collector/ (GitHub Actions, 6時間ごと)
  collect.ts   Riot API → data/state/records/{route}.ndjson（参加者1人=1レコード）に追記
  aggregate.ts records → public/data/stats.json（クラスタリング・集計）
  cdragon.ts   Community Dragon から trait/unit/emblem/item 辞書（日英名・アイコン・プランナーcode）
src/ (Vite + React, Netlify配信)
  stats.json を fetch して表示（クライアント側で再集計・絞り込み）
shared/types.ts  収集側とフロントの共有型（ParticipantRecord, StatsFile, CompStats ...）
```

集計の要点（`aggregate.ts`）:
- レコードを「発動中の上位2特性（ゴールド以上があればそれ、無ければ最強2つ）」でクラスタ化＝構成。
- 構成ごとに: 代表ユニット/★/推奨アイテム、紋章ごとの装備者(holders)、紋章組合せごとの成績(rows)、代表シナジー(synergies) を集計。
- 全体に加えレベル別(7〜10)も出力（`compsByLevel`）。サイズ抑制のため低nの行は枝刈り。

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
| `npm test` | テスト（collector の patches/state、src の multiset） |
| `npm run collect` | Riot API からマッチ収集 → `data/state/` に追記（`.env` のキー使用） |
| `npm run aggregate` | `data/state/` → `public/data/stats.json` 集計 |

## 運用・デプロイ

- **CI 収集**: `.github/workflows/collect.yml` が6時間ごとに collect→aggregate→commit。Netlify が push で再デプロイ。
- **APIキー**: CI が使うのは **GitHubリポジトリ Secret `RIOT_API_KEY`**（ローカル `.env` ではない）。開発キーは**24時間で失効**するので、失効すると collect が 401 で失敗し収集が止まる。`gh secret set RIOT_API_KEY --body "RGAPI-..."`（パイプ流し込みは BOM/改行混入の恐れがあるため `--body`）または Settings→Secrets→Actions で更新。恒久対応は**本番APIキー**への切替。
- 手動収集: ローカルで有効な `.env` があれば `npm run collect && npm run aggregate` で更新→commit も可能。

## 既知の課題 / TODO

- **チームコードの形式**: 現行は `02` + 各チャンピオン12bit(3桁hex, team_planner_code) + `TFTSet{n}`。実機での有効性は要再検証（クライアント生成コードとの突き合わせ）。
- **生成ユニット**: `rec.u`（盤面）に `TFT17_Summon` / `TFT17_IvernMinion` 等の召喚ユニットが混入し、盤面数>レベルになるケースが約24%。構成のユニット表示・レベル整合のため除外を検討（IvernMinion がショップ正規かの確定が必要）。
- **本番APIキー**: 取得後に Secret 差替え＋`config.enableDiamond=true` で Diamond 帯収集も有効化可能（現状は dev キーのレート上限回避で off）。
- **レコードのストレージ**: 現状 records を git にコミットしており履歴が肥大化する。配信は静的 `stats.json` 継続のまま、records を squash する data ブランチ等へ移すのが望ましい。
