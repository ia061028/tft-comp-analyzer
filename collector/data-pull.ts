// data/state を orphan ブランチ `data` の最新スナップショットへ同期する（npm run data:pull）。
//
// 重要: data/state が「独立した git チェックアウト」であることを必ず検証してから reset する。
// 検証なしに `git -C data/state reset --hard` を実行すると、data/state がただのディレクトリ
// だった場合に git が親（main リポジトリ）の .git を辿り、main の作業ツリー全体を
// origin/data へ hard reset して壊してしまうため。
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const STATE_DIR = join(here, '..', 'data', 'state')

if (!existsSync(join(STATE_DIR, '.git'))) {
  console.error(
    'data/state が独立した git チェックアウトではありません。先に初回セットアップを実行してください:\n' +
      '  git clone --depth 1 --branch data https://github.com/ia061028/tft-comp-analyzer.git data/state',
  )
  process.exit(1)
}

execFileSync('git', ['-C', STATE_DIR, 'fetch', '--depth', '1', 'origin', 'data'], {
  stdio: 'inherit',
})
// data ブランチは squash force-push 運用のため pull ではなく reset --hard で追従する。
execFileSync('git', ['-C', STATE_DIR, 'reset', '--hard', 'origin/data'], { stdio: 'inherit' })
console.log('data/state を origin/data の最新スナップショットに同期しました。')
