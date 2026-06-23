# Cloudflare Pages 移行 — Gemini 引き継ぎ文書

> このファイルは、GitHub Pages → Cloudflare Pages へのホスティング移行作業を引き継ぐための自己完結したハンドオフです。
> 作業者はこのリポジトリの文脈を初見である前提で書いています。まずこの文書を最後まで読んでから着手してください。

## 0. プロジェクト概要（前提知識）

- **tft-comp-analyzer**: TFT（Teamfight Tactics）の高ランク対戦データを集計して見せる個人用 Web アプリ。
- リポジトリ: `github.com/ia061028/tft-comp-analyzer`（ブランチは `main` 運用）。
- 構成: **Vite + React + TypeScript + Tailwind v4** の純静的 SPA。
  - データ収集: GitHub Actions（`.github/workflows/collect.yml`、6時間ごとの cron、最長45分ジョブ）が Riot API を叩き、`public/data/stats.json`（約1.25MB、`schemaVersion: 3`）をリポジトリに commit→push する。
  - 表示: ユーザーが紋章（emblem）を選ぶと、それを活用している構成（comp）が一覧表示される。
- 現在のライブ URL: `https://ia061028.github.io/tft-comp-analyzer/`（GitHub Pages、サブパス配信）。
- クライアントサイドルーティングは無し（単一 `index.html`）。→ SPA フォールバック（`_redirects`）は不要。

## 1. このタスクのゴール

ホスティングを **GitHub Pages → Cloudflare Pages** に移行する。狙い:
- **ルート URL 化**（`/tft-comp-analyzer/` サブパスの解消）。
- **帯域無制限・無料**（増え続ける `stats.json` の配信に強い）。

データ収集（`collect.yml`）はそのまま GitHub Actions に残す。collect.yml が main に push するたびに、Cloudflare の Git 連携が自動で再ビルド・再デプロイする運用にする。

## 2. コード/リポジトリ側の変更（＝引き継ぎ先が実施）

| # | ファイル | 変更 |
|---|---------|------|
| 1 | `vite.config.ts` | `base: '/tft-comp-analyzer/'` → `base: '/'` |
| 2 | `.nvmrc`（新規作成） | 内容は `22`（Cloudflare ビルドの Node を固定。現 deploy.yml と同じ） |
| 3 | `.github/workflows/deploy.yml` | **削除**（GH Pages 自動デプロイを停止。base を `/` にすると subpath 配信が壊れるため、二重・破損デプロイを防ぐ。必要なら git 履歴から復元可） |
| 4 | `README.md` | ライブ URL を Cloudflare（`https://tft-comp-analyzer.pages.dev/` 想定。実プロジェクト名で確定）に更新 |

### 変更不要なもの（重要）
- `src/lib/data.ts`: データ取得は `fetch(\`${import.meta.env.BASE_URL}data/stats.json\`)`。`import.meta.env.BASE_URL` は vite の `base` に追従するので **変更不要**。
- `collector/` 配下、`collect.yml`: 収集ロジックは無関係。**触らない**。

### 現状の `vite.config.ts`（参考）
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/tft-comp-analyzer/',
  plugins: [react(), tailwindcss()],
})
```

## 3. 検証手順（コード変更後、ローカルで）

```sh
npm install            # 未インストールなら
npx tsc -b             # 型チェック
npm test               # Node --test（tsx 経由）
npm run lint           # ESLint
npm run build          # dist 生成
```
- `npm run build` 後、`dist/index.html` 内のアセット参照が `/assets/...`（**ルート基準**、`/tft-comp-analyzer/assets/...` ではない）になっていることを確認。
- `npm run dev` → `http://localhost:5173/`（サブパス無し）でデータ読込・紋章選択→構成表示が動くことを確認。

## 4. 手動操作（＝ユーザー本人が Cloudflare ダッシュボードで実施）

引き継ぎ先（AI）は Cloudflare の操作はできない。以下はユーザーに依頼する手順として案内すること:
1. Cloudflare アカウント作成 → **Workers & Pages → Pages → Connect to Git** で `ia061028/tft-comp-analyzer` を連携。
2. ビルド設定: Production branch=`main`、Framework preset=Vite（または None）、**Build command=`npm run build`**、**Output dir=`dist`**。Node は `.nvmrc` で 22 に固定される。
3. Deploy 実行 → `*.pages.dev` URL を取得（必要なら独自ドメイン＋SSL）。
4. デプロイ確認後、旧 GitHub Pages を無効化（リポジトリ Settings → Pages → Source を None）。

## 5. デプロイ後の確認
- `https://<project>.pages.dev/` が 200。
- `https://<project>.pages.dev/data/stats.json` が 200・`schemaVersion: 3`。
- 紋章選択 → 構成表示、発動特性・活用（X/N）が正常に出る。
- 次回 `collect.yml` push（または手動 push）で Cloudflare が自動再デプロイされること。

## 6. 落とし穴・運用上の注意（必読）

- **base を `/` にすると GitHub Pages（subpath 配信）は壊れる**。なので `deploy.yml` 削除とセットで行うこと。中途半端に片方だけやらない。
- **collect-bot のリベース衝突**: スケジュール実行の collect.yml が頻繁に main へ push する。ローカルで push しようとすると `stats.json` で rebase 衝突が起きることがある。解決法: `git rebase origin/main` → `npm run aggregate`（最新データから stats.json を再生成）→ `git add` → `git rebase --continue`。**stats.json を手で merge しない**。
- **コミット/プッシュは、ユーザーが明示的に依頼したときだけ**行う。デプロイは main への push でのみ発生する。
- **Riot API キーを絶対に出力・コミットしない**。CI は GitHub Secret `RIOT_API_KEY` を使う（`.env` とは別物）。開発キーは24時間で失効。Secret 更新は `gh secret set RIOT_API_KEY --body "..."`（**パイプ渡しは BOM/改行混入の恐れがあるので使わない**）。今回の移行では API キーには触れない。
- 旧 `/tft-comp-analyzer/` URL はリンク切れになる。ブックマーク/共有先の更新が必要。
- 無料枠の数値（ビルド回数 500/月、帯域）は変動し得るので公式で確認。収集は6時間ごと（≈4ビルド/日）なので 500/月に十分収まる。

## 7. 参照
- 元の計画ファイル（Claude 側）: `C:\Users\ia061\.claude\plans\lovely-finding-trinket.md`
- リポジトリ: `github.com/ia061028/tft-comp-analyzer`
