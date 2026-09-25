import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions,
  pickTargetPatch,
  isSynthesizedPatch,
  resolvePatch,
  planPatchViews,
  planRecentViews,
  ALL_PATCHES_KEY,
} from './patches.ts'

test('compareVersions: "16.9" < "16.10"（数値比較）', () => {
  assert.ok(compareVersions('16.9', '16.10') < 0)
  assert.ok(compareVersions('16.10', '16.9') > 0)
})

test('compareVersions: 等値は 0', () => {
  assert.equal(compareVersions('16.12', '16.12'), 0)
})

test('compareVersions: メジャー差を優先', () => {
  assert.ok(compareVersions('17.1', '16.99') > 0)
})

test('compareVersions: B パッチのサフィックスは同じ minor の中で無印より後', () => {
  assert.ok(compareVersions('18.2', '18.2b') < 0)
  assert.ok(compareVersions('18.2b', '18.2') > 0)
  assert.ok(compareVersions('18.2b', '18.3') < 0)
  assert.ok(compareVersions('18.2b', '18.2c') < 0)
  assert.equal(compareVersions('18.2b', '18.2b'), 0)
  // minor の数値比較はサフィックス有無に関わらず優先される。
  assert.ok(compareVersions('18.10', '18.9b') > 0)
  assert.ok(compareVersions('18.10b', '18.10') > 0)
})

test('compareVersions: パース不能は最小扱い', () => {
  assert.ok(compareVersions('garbage', '16.1') < 0)
  assert.ok(compareVersions('16.1', 'garbage') > 0)
  // 両方パース不能なら等値。
  assert.equal(compareVersions('garbage', 'nonsense'), 0)
})

test('pickTargetPatch: 新パッチが閾値未満なら旧パッチを維持（ヒステリシスの核心）', () => {
  // 16.12 は新しいが 50 < 200。16.11 は 300 >= 200。降順走査で 16.12 を飛ばし 16.11 を選ぶ。
  const m = new Map([
    ['16.11', 300],
    ['16.12', 50],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.11')
})

test('pickTargetPatch: 新パッチが閾値到達で切替', () => {
  const m = new Map([
    ['16.11', 300],
    ['16.12', 250],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.12')
})

test('pickTargetPatch: 全部閾値未達ならマッチ数最多', () => {
  const m = new Map([
    ['16.11', 120],
    ['16.12', 80],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.11')
})

test('pickTargetPatch: 全部未達・同数ならバージョン新しい方', () => {
  const m = new Map([
    ['16.11', 100],
    ['16.12', 100],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.12')
})

test('pickTargetPatch: 空 Map は null', () => {
  assert.equal(pickTargetPatch(new Map(), 200), null)
})

test('pickTargetPatch: 実 sea データ相当（16.12=651 >= 200 で 16.12）', () => {
  const m = new Map([
    ['16.12', 651],
    ['16.11', 494],
    ['16.10', 43],
  ])
  assert.equal(pickTargetPatch(m, 200), '16.12')
})

// ---- resolvePatch ----

const SCHEDULE = [
  { patch: '18.1', since: '2026-08-26T00:00:00Z' },
  { patch: '18.2', since: '2026-09-10T00:00:00Z' },
]
const T = (iso: string) => Math.floor(Date.parse(iso) / 1000)

test('isSynthesizedPatch: "{set}.0" だけが合成キー', () => {
  assert.equal(isSynthesizedPatch('18.0'), true)
  assert.equal(isSynthesizedPatch('18.1'), false)
  assert.equal(isSynthesizedPatch('18.10'), false)
  assert.equal(isSynthesizedPatch('garbage'), false)
})

test('resolvePatch: 実パッチはスケジュールを無視してそのまま', () => {
  assert.equal(resolvePatch('18.3', T('2026-09-01T00:00:00Z'), SCHEDULE), '18.3')
})

test('resolvePatch: 合成キーは ts で最新の since <= ts を選ぶ', () => {
  assert.equal(resolvePatch('18.0', T('2026-09-01T12:00:00Z'), SCHEDULE), '18.1')
  assert.equal(resolvePatch('18.0', T('2026-09-10T00:00:00Z'), SCHEDULE), '18.2')
  assert.equal(resolvePatch('18.0', T('2026-09-12T20:00:00Z'), SCHEDULE), '18.2')
})

test('resolvePatch: 最初の配信より前・スケジュール未登録セットは合成キーのまま', () => {
  assert.equal(resolvePatch('18.0', T('2026-08-01T00:00:00Z'), SCHEDULE), '18.0')
  assert.equal(resolvePatch('19.0', T('2026-09-12T00:00:00Z'), SCHEDULE), '19.0')
})

test('resolvePatch: スケジュールの並び順に依存しない', () => {
  const reversed = [...SCHEDULE].reverse()
  assert.equal(resolvePatch('18.0', T('2026-09-12T00:00:00Z'), reversed), '18.2')
  assert.equal(resolvePatch('18.0', T('2026-09-01T00:00:00Z'), reversed), '18.1')
})

// ---- planPatchViews ----

test('planPatchViews: 閾値到達パッチが2つ以上なら all + 各パッチ（昇順）、既定は最新', () => {
  const m = new Map([
    ['18.2', 5000],
    ['18.1', 30000],
  ])
  const { defaultKey, views } = planPatchViews(m, 200)
  assert.equal(defaultKey, '18.2')
  assert.deepEqual(views, [
    { key: ALL_PATCHES_KEY, patches: ['18.1', '18.2'] },
    { key: '18.1', patches: ['18.1'] },
    { key: '18.2', patches: ['18.2'] },
  ])
})

test('planPatchViews: 新パッチが閾値未満なら単独ビューにせず、既定も旧パッチ（ヒステリシス）', () => {
  const m = new Map([
    ['18.1', 30000],
    ['18.2', 50],
  ])
  const { defaultKey, views } = planPatchViews(m, 200)
  assert.equal(defaultKey, '18.1')
  assert.deepEqual(views, [{ key: '18.1', patches: ['18.1'] }])
})

test('planPatchViews: 全部閾値未達でも既定ビューは必ず出す', () => {
  const m = new Map([['18.2', 50]])
  const { defaultKey, views } = planPatchViews(m, 200)
  assert.equal(defaultKey, '18.2')
  assert.deepEqual(views, [{ key: '18.2', patches: ['18.2'] }])
})

test('planPatchViews: all ビューは閾値未達パッチも含める（合算＝セット全体）', () => {
  const m = new Map([
    ['18.1', 300],
    ['18.2', 300],
    ['18.3', 10],
  ])
  const { views } = planPatchViews(m, 200)
  assert.deepEqual(views[0], { key: ALL_PATCHES_KEY, patches: ['18.1', '18.2', '18.3'] })
  assert.deepEqual(views.slice(1).map((v) => v.key), ['18.1', '18.2'])
})

test('planPatchViews: 空 Map は views 空', () => {
  assert.deepEqual(planPatchViews(new Map(), 200), { defaultKey: null, views: [] })
})

// ---- planRecentViews ----

const DAY = 86400
/** 0..hours 時間目まで 1 時間ごとに perHour 試合ずつ。 */
function hourlyMatches(hours: number, perHour: number, start = 1_790_000_000): Map<string, number> {
  const m = new Map<string, number>()
  for (let h = 0; h <= hours; h++) for (let k = 0; k < perHour; k++) m.set(`M${h}_${k}`, start + h * 3600)
  return m
}

test('planRecentViews: パッチが窓より長ければ長い窓から順に出す（終端は最新の試合）', () => {
  const ts = hourlyMatches(5 * 24, 10)
  const plans = planRecentViews(ts, [1, 3], 200)
  assert.deepEqual(
    plans.map((p) => [p.key, p.days, p.matches]),
    [
      ['recent3d', 3, (3 * 24 + 1) * 10],
      ['recent1d', 1, (24 + 1) * 10],
    ],
  )
  const maxTs = Math.max(...ts.values())
  assert.equal(plans[0].since, maxTs - 3 * DAY)
})

test('planRecentViews: パッチ全体を覆う窓は出さない（パッチビューと同じ中身）', () => {
  const plans = planRecentViews(hourlyMatches(30, 10), [3, 1], 200)
  assert.deepEqual(
    plans.map((p) => p.key),
    ['recent1d'],
  )
  assert.deepEqual(planRecentViews(hourlyMatches(20, 10), [3, 1], 200), [])
})

test('planRecentViews: 閾値未満の窓と、長い窓と同じ試合数の窓は出さない', () => {
  // 3 日前に 1 試合だけ、あとは直近 12 時間に固まっている → 3日と1日が同じ中身になる
  const ts = hourlyMatches(12, 50, 1_790_000_000 + 3 * DAY)
  ts.set('old', 1_790_000_000 - DAY)
  const plans = planRecentViews(ts, [3, 1], 200)
  assert.deepEqual(
    plans.map((p) => p.key),
    ['recent3d'],
  )
  assert.deepEqual(planRecentViews(hourlyMatches(5 * 24, 1), [3, 1], 200), [])
  assert.deepEqual(planRecentViews(new Map(), [3, 1], 200), [])
})
