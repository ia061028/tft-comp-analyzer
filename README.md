# TFT 紋章構成アナライザー

TFT（Teamfight Tactics）のプレイ支援用Webアプリ。Riot APIから高ランク帯（Master以上）の戦績を6時間ごとに自動収集し、紋章を複数選択（重複可）→ その紋章セットを使った構成を Top4率/1位率でランキング表示する自分専用ツール。

設計・フェーズ計画の詳細は [PLAN.md](PLAN.md) を参照。

## セットアップ

```sh
npm install
cp .env.example .env   # RIOT_API_KEY を設定（https://developer.riotgames.com、開発キーは24hで失効）
```

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | フロントエンド開発サーバー |
| `npm run build` | 本番ビルド（tsc + vite） |
| `npm run collect` | Riot APIからマッチ収集 → `data/state/` に追記 |
| `npm run aggregate` | `data/state/` → `public/data/stats.json` 集計（Phase 3で実装） |

## デプロイ（Phase 6・初回のみの手動作業）

1. **GitHubパブリックリポジトリ**を作成して push（パブリックなのはActions無制限のため。キーはSecretsで保護）
   ```sh
   gh repo create tft-comp-analyzer --public --source . --push
   ```
2. **Secret登録**: リポジトリの Settings → Secrets and variables → Actions に `RIOT_API_KEY` を登録
   ```sh
   gh secret set RIOT_API_KEY
   ```
   ⚠️ 開発キーは**24時間で失効**する。毎日 https://developer.riotgames.com で再発行し、`gh secret set RIOT_API_KEY` で更新すること（失効するとcollectワークフローが赤失敗し、GitHubからメール通知が来る。サイトは旧データの配信を継続する）。
3. **Netlify連携**: Netlifyダッシュボード → Add new site → Import an existing project → GitHubリポジトリを選択。ビルド設定は `netlify.toml`（build: `npm run build`, publish: `dist`）が自動適用される。
4. 動作確認: Actionsタブから `collect` を手動実行（workflow_dispatch）→ state＋stats.json の更新コミット → Netlifyが自動デプロイ。

## 計測メモ

### stateサイズ（Phase 2 実測, 2026-06-12, SEAルート）

- 1,000マッチ（=8,000参加者レコード）あたり: `records/sea.ndjson` 約3.1MB、`seen/sea.ndjson` 約17KB
- 1回のフルラン（25分・上限1000マッチ）の実績: リクエスト1,242件・429ゼロ・実効約49req/分（リージョナルルート）
- **注意**: PLAN.md の見積り（10〜30MB/パッチ）より大きい。全4ルート×4回/日のフル稼働だと約50MB/日 → 1パッチ（約2週間）で数百MB規模になりうる。Phase 5 で `maxNewMatchesPerRoutePerRun` の調整またはレコード圧縮（apiNameのセットプレフィックス除去など）を検討すること。
