# TFT 紋章構成アナライザー 実装計画

## Context

TFT（Teamfight Tactics）のプレイ支援用Webアプリをゼロから開発する。Riot APIから高ランク帯（Master以上・全リージョン）の戦績を6時間ごとに自動収集し、**ユーザーが紋章を複数選択（同一紋章の重複可）→ その紋章セットを使った構成を Top4率/1位率でランキング表示**する自分専用ツール。対象ディレクトリ `C:\Users\ia061\projects\tft-comp-analyzer` は完全に空（greenfield）。

## 合意済みの設計判断

| 項目 | 決定 |
|---|---|
| 収集範囲 | 全15プラットフォームの Challenger+GM 全員 ＋ Master はプラットフォームごと上限まで抽選（上限は設定可能） |
| データ蓄積 | 現行パッチのみ累積。処理済みマッチIDをリポジトリに保存し増分取得。パッチ変更時はヒステリシス付きで移行 |
| 構成クラスタキー | 発動シナジーのうち style>=3（ゴールド以上）の組み合わせ。閾値は設定可能 |
| 紋章の使用判定 | 紋章を装備 かつ その紋章のシナジーが1段階でも発動（tier_current>=1）していればカウント |
| 紋章マッチング | 選択した紋章マルチセットを「以上」含む構成を表示（部分集合マッチ、クライアント側で再集計） |
| 紋章グリッド表示範囲 | 収集データ中に出現した全紋章 |
| リポジトリ | **パブリック**（Actions無制限のため。APIキーはSecretsで保護） |
| サンプル閾値 | デフォルト minSample=20、UI側スライダーで変更可能 |

## 検証済みAPI事実（Plan agent調査結果）

- **tft-league-v1 の DTO は `puuid` を直接含む**（2025年6月に summonerId 系は廃止済み）。summoner-v1 ルックアップ不要。puuid 欠落エントリはスキップ。
- **プラットフォーム→リージョナルルート対応**: americas={na1,br1,la1,la2} / asia={kr,jp1} / europe={euw1,eun1,tr1,ru,me1} / sea={**oc1**,sg2,tw2,vn2}（oc1はseaルート。ph2/th2はsg2に統合済みで存在しない）
- **紋章のapiNameはセット固有で不規則**（例: Set15のDuelist紋章は `TFT15_Item_ChallengerEmblemItem`）。名前の正規表現マッチは禁止。Community Dragon `en_us.json` の items で `associatedTraits` が非空のアイテム＝紋章とし、`associatedTraits[0]` でトレイトに紐付ける。
- **CDragonアイコンURL変換**: `icon` パスを小文字化、`.tex`/`.dds`→`.png`、`https://raw.communitydragon.org/latest/game/` を前置（動作確認済み・ホットリンク可）。静的データ元: `https://raw.communitydragon.org/latest/cdragon/tft/en_us.json`（現行Set 17）。
- **レート制限**: 開発キーは 20req/s ＋ 100req/2分 を**ルーティング値ごと**に適用。4リージョナルルート並列＋ルート内逐次で、1ルートあたり実効50req/分。約30分の実行で **1回あたり約3,600〜4,000マッチ**収集可能。
- マッチリストにキュー絞り込みは無い。取得後に `info.queue_id===1100` かつ `tft_game_type==="standard"` でフィルタし、**破棄したIDも処理済みセットに入れて再取得を防ぐ**。
- パッチ抽出は `info.game_version` を `/(\d+)\.(\d+)/` でパース。`info.tft_set_number` も記録。

## リポジトリ構成（単一パッケージ・workspacesなし）

```
tft-comp-analyzer/
├── package.json / tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── vite.config.ts / index.html / netlify.toml
├── .env (gitignore) / .env.example / .gitignore
├── PLAN.md                  # この計画の写し（セッション間参照用）
├── shared/types.ts          # 収集側・フロント側で共有する型
├── collector/
│   ├── config.ts            # プラットフォーム一覧、ルート対応、各種上限・閾値
│   ├── riot.ts              # fetchラッパ＋ルーティング値ごとトークンバケット＋429 Retry-After対応
│   ├── cdragon.ts           # en_us.json取得、紋章→トレイト/ユニット辞書、アイコンURL変換
│   ├── state.ts             # NDJSON状態の読み書き、処理済みIDセット、パッチ移行
│   ├── collect.ts           # エントリ: リーグ→puuid→マッチID→マッチ詳細→state追記
│   └── aggregate.ts         # エントリ: state → public/data/stats.json
├── src/                     # フロントエンド
│   ├── main.tsx / App.tsx
│   ├── lib/data.ts          # /data/stats.json ロード
│   ├── lib/multiset.ts      # マルチセット部分集合マッチ＋クライアント再集計
│   └── components/{EmblemGrid,SelectionBar,CompList}.tsx
├── data/state/              # コミットされる収集状態（配信されない）
│   ├── meta.json
│   ├── seen/{route}.ndjson      # 処理済みマッチID（1行1ID、追記専用）
│   └── records/{route}.ndjson   # 参加者レコード（1行1件、追記専用）
├── public/data/stats.json   # 集計出力（Vite/Netlifyが /data/stats.json で配信）
└── .github/workflows/collect.yml
```

- stateは**素のNDJSON**（gzip不可: gitのdelta圧縮を活かす）。コンパクトレコードで現実的に10〜30MB/パッチ。
- 集計出力は `public/` 配下なので dev/本番とも同一パス `/data/stats.json` で取得。ビルド時importではなく実行時fetch。

## データスキーマ

### 参加者レコード（data/state/records/*.ndjson、1行1参加者）
```json
{"m":"SG2_88412345","v":"16.11","p":3,"t":{"TFT17_Sorcerer":4,"TFT17_StarGuardian":2},"e":["TFT17_Item_SorcererEmblemItem","TFT17_Item_SorcererEmblemItem"],"u":["TFT17_Ahri","TFT17_Lux"],"lv":9,"ts":1760000000}
```
- `t`: tier_current>=1 の全トレイト→style値（style閾値は集計時適用＝再収集なしで変更可能）
- `e`: 装備された全紋章apiName（重複保持・無フィルタ。発動条件は集計時に適用）
- `u`: character_id一覧（クラスタ代表ユニット算出用）

### 集計出力（public/data/stats.json）
```json
{
  "schemaVersion": 1, "generatedAt": "...", "patch": "16.11", "setNumber": 17,
  "config": { "minStyle": 3, "minSampleDefault": 20 },
  "totals": { "matches": 0, "participants": 0, "byRoute": {} },
  "traits":  [{ "api": "...", "name": "...", "icon": "https://..." }],
  "emblems": [{ "api": "...", "name": "...", "trait": 0, "icon": "https://..." }],
  "units":   [{ "api": "...", "name": "...", "cost": 4, "icon": "https://..." }],
  "comps": [{
    "traits": [[0,4],[7,3]],          // [traitIdx, 最頻style] ソート済み＝クラスタキー
    "label": "Sorcerer / Star Guardian",
    "units": [3,12,18,22,25,30,31,40], // クラスタ内最頻8ユニット（コスト順）
    "n": 1840, "top4": 1012, "win": 261,
    "rows": [                          // 紋章マルチセットごとの内訳
      { "e": [], "n": 1100, "top4": 560, "win": 130 },
      { "e": [4,4], "n": 220, "top4": 142, "win": 43 }
    ]
  }]
}
```
- traits/emblems/units はインターン配列、他はインデックス参照（200KB〜1MB想定）
- フロントは選択マルチセット⊆`row.e` の行を構成ごとに合算→選択指標でソート。空選択時は構成全体のティアリスト表示。

## 主要な落とし穴と対策（実装に織り込む）

1. **CDragonのパッチ追従遅延**: 解決できないトレイト/アイテム名のレコードは集計から除外して警告ログ。生stateは保持しているので次回cronで自然回復。
2. **パッチ移行ヒステリシス**: パッチはリージョン順次展開（〜24h）。新パッチを1試合見ただけでリセットしない。レコードにパッチをタグ付けし直近2パッチを保持、新パッチが200試合超えたら切替＆旧パッチをprune。
3. **レートリミッタ**: ルーティング値ごとにトークンバケット（20/s＋100/120s）、429の Retry-After 尊重、5xxリトライ。4ルートは Promise.all 並列・ルート内逐次。
4. **マッチID取得**: `count=20`、`startTime`=前回実行−1hで古いIDをカット。8人が同一マッチを共有するため重複排除が効く。
5. **Actionsの安全策**: トリガーは `schedule`＋`workflow_dispatch` のみ（自分のコミットで再発火しない）。`concurrency: {group: collect}` で単一実行。push前に `git pull --rebase` 3回リトライ。
6. **キー失効（24h）**: 実行冒頭に安価な認証プリフライト（401/403なら state に触れる前に exit 1）。ワークフロー失敗→GitHubがメール通知→Netlify上の旧 stats.json は配信され続ける。`timeout-minutes: 45`。

## 設定値デフォルト（collector/config.ts、すべて変更可能）

- `matchIdsPerPlayer: 20` / `maxNewMatchesPerRoutePerRun: 1000` / `masterSamplePerPlatform: 100`
- `clusterMinStyle: 3` / `minSampleDefault: 20` / `patchSwitchThreshold: 200試合`
- 実行時間バジェット: 残り5分で取得を打ち切り、集計とflushは必ず実施

## フェーズとマイルストーン

### Phase 1 — スキャフォールド
Vite(react-ts)＋Tailwind(v4)＋tsx＋dotenv のセットアップ、`shared/types.ts`・`collector/`骨組み、`.gitignore`（.env/node_modules/dist）、`git init`、**PLAN.md 作成**（この計画の写し）。
**完了条件**: `npm run dev` でダークなプレースホルダ表示。`npm run collect` が `.env` のキーで sg2 のチャレンジャー人数と先頭puuidを出力（キー・DTO・配線の証明）。

### Phase 2 — SEA限定コレクター
`riot.ts`（リミッタ・429/5xx対応）、`state.ts`、`collect.ts` を sea ルートのみで実装（oc1+sg2+tw2+vn2 のリーグ→puuidプール→Master抽選→マッチID→詳細取得→キュー/パッチフィルタ→NDJSON追記）。
**完了条件**: 1回の実行で500マッチ以上収集、429ストームなし。直後の再実行で新規取得≈0（増分dedupeの証明）。1,000マッチあたりのstateサイズをREADMEに記録。

### Phase 3 — 静的データ＋集計
`cdragon.ts`（en_us.json→紋章/トレイト/ユニット辞書、アイコンURL変換）と `aggregate.ts`（style>=3クラスタリング、発動トレイト紋章フィルタ、マルチセットrow、代表ユニット算出、インターン）。
**完了条件**: `npm run aggregate` がスキーマ通りの stats.json を出力。setNumber=17 記録、非空の紋章rowを持つ構成が1つ以上、未解決名警告ゼロ。

### Phase 4 — フロントエンドMVP
紋章グリッド（CDragonアイコン）、クリックで個数バッジ付きマルチセット選択、構成リスト（大きいユニットアイコン）、Top4%/1位%トグル、サンプル数表示、minサンプルスライダー。ダーク・デスクトップ専用・2階層のみ。
**完了条件**: 「ソーサラー紋章×2」選択でその行を含む構成のみ表示、表示レートが stats.json から手計算した値と一致。空選択で全体ティアリスト表示。

### Phase 5 — 全リージョン展開
config.ts で全15プラットフォーム/4ルート有効化、ルート並列＋ルートごとリミッタ、実行時間バジェットガード、パッチ移行ヒステリシス＋prune。
**完了条件**: コールドフルランが35分以内に完走、各ルートが上限到達または新規枯渇、リミッタ統計でリクエスト数が理論バジェット内、パッチ変更のテストフィクスチャでpruneが正しく動作。

### Phase 6 — CI＋デプロイ
GitHubへpush（**パブリックリポジトリ**）。`collect.yml`（cron `17 */6 * * *`＋workflow_dispatch、concurrency、timeout-minutes:45、Secret `RIOT_API_KEY`、認証プリフライト、collect→aggregate→rebaseリトライ付きcommit）。Netlify接続（build: `npm run build`、publish: `dist`）。
**完了条件**: 手動dispatchで state＋stats.json が更新コミットされNetlifyが自動デプロイ。わざと無効キーで実行→コミットなしで赤失敗、サイトは旧データ配信継続。連続2回のcron実行がpush衝突なしで完走。

## 検証方法

- Phase 2: 実行ログのHTTPステータス集計（429/5xx件数）とマッチ件数で確認。再実行のdedupe検証。
- Phase 3: stats.json を jq 等で目視＋スキーマ整合確認。既知の構成（メタ構成）が上位に出るかの妥当性チェック。
- Phase 4: `/verify` 相当の手動E2E — devサーバーで紋章選択→表示値を stats.json から手計算と突き合わせ。
- Phase 6: workflow_dispatch での実走、無効キーでのフェイル挙動、Netlify本番URLでの表示確認。

## ユーザー側の手動作業（実装外）

- GitHubパブリックリポジトリの作成（gh CLIで代行可能）と Secret `RIOT_API_KEY` の登録・**24時間ごとの手動更新**
- Netlify アカウントでのGitHub連携設定（手順は README に記載する）
