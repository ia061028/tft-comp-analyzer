import type { CSSProperties } from 'react'
import type { StatsFile } from '../../shared/types'
import type { Family, Span } from '../lib/backbone'
import { DIM_SAMPLE_MAX } from '../lib/format'
import { pickName, t, type Lang } from '../lib/i18n'
import { DerivRow } from './DerivRow'
import { RecipeLabel } from './RecipeLabel'
import { Tip } from './Tip'

interface FamilyCardProps {
  stats: StatsFile
  family: Family
  cohort: Map<number, number>
  /** 採用数が薄い派生行を淡く描く（「少数を薄く」ON のとき）。消さずに弱めるだけ。 */
  dimLowSample: boolean
  lang: Lang
}

/**
 * 1系統 ＝ 体数グループの束。
 *
 * 列は**体数グループごと**に組む。全派生に出る共通駒が左に固定で並び、残りは右の枠を
 * 共有して詰まるので、共通であることが並びだけで分かり、行の幅は体数ぶんで収まる。
 * 系統ぜんぶの和集合を列にすると 8体の構成が 21 列に散って、かえって読めなくなる。
 * 列が誰かは駒の顔が語るので、見出しで名前を並べたりはしない。
 *
 * **見出しはアイテムも紋章の装備者も主張しない。** 同じ系統でも派生によって装備者そのものが
 * 変わる（実データで確認済み）ので、代表値を置くと嘘になる。それらは行ごとに描く。
 *
 * **体数グループをまたいで線や矢印を引かない。** 8体 → 9体 は「駒を1つ足した改善」ではなく
 * 「9体まで生き残れた人の成績」なので（平均順位は実質ユニット数を測っている）、
 * 親→子の関係として見せると最も誤解を招く。比較が正当なのは**同じ体数の兄弟の間だけ**。
 */
export function FamilyCard({ stats, family, cohort, dimLowSample, lang }: FamilyCardProps) {
  const { emblems } = stats
  const { used, groups } = family

  // overflow-hidden は使わない。角丸のためにクリップすると、ユニット上のツールチップが
  // カードの縁で切られて読めなくなる。角丸は子側で処理する。
  return (
    <div className="rounded-xl border border-line bg-surface">
      {/*
       * 列の見出し（ユニットの顔と名前）は置かない。21列まで伸びると名前は「リ..」「カ..」まで
       * 潰れて読めず、縦も食うだけだった。駒は顔で分かるので、名前はツールチップに任せる。
       * 使っている紋章も、複数を積む系統のときだけ出す（1枚なら上の選択バーと同じことを言う）。
       */}
      {used.length > 1 && (
        <div className="flex items-center justify-end gap-1.5 rounded-t-xl border-b border-line bg-gradient-to-b from-gold/[0.06] to-black/20 px-4 py-2">
          {used.map((ei, i) => {
            const e = emblems[ei]
            if (!e) return null
            return (
              <Tip key={i} label={<RecipeLabel label={pickName(lang, e)} recipe={e.recipe} />}>
                <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line-strong bg-surface-2 pl-1 pr-2 text-[11px] font-medium text-muted">
                  <img
                    src={e.icon}
                    alt=""
                    loading="lazy"
                    className="h-[17px] w-[17px] rounded bg-base object-contain ring-1 ring-gold"
                  />
                  {pickName(lang, e)}
                </span>
              </Tip>
            )
          })}
        </div>
      )}

      {/* ───── 体数グループ。常に開いた状態で出す（畳まない） ───── */}
      {groups.map((g) => (
        <div key={g.units}>
          <div
            title={t(lang, 'compareWithin')}
            className="flex w-full items-center gap-x-3 gap-y-1 rounded-t-xl border-t border-line bg-black/20 px-4 pb-1.5 pt-2.5 text-left first:border-t-0"
          >
            <span className="w-[52px] shrink-0 text-[15px] font-extrabold text-ink">
              {t(lang, 'unitsGroup', { n: g.units })}
            </span>

            {/*
             * このグループの成績の幅。**同じ体数の中だけ**で集計しているので、数字が歪まない。
             * 系統全体で集計すると 7体〜10体が混ざり、平均順位の幅（例 1.83〜6.74）が
             * 構成の差ではなく生存バイアスそのものになる。
             */}
            <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-faint tabular-nums">
              {span(t(lang, 'avgPlace'), g.place, (x) => x.toFixed(2))}
              {span(t(lang, 'metricTop4'), g.top4, pct)}
              {span(t(lang, 'metricWin'), g.win, pct)}
            </span>

            <span className="ml-auto shrink-0 text-[11px] text-faint tabular-nums">
              {t(lang, 'derivCount', { n: g.derivs.length })}
            </span>
          </div>

          {/*
           * 列ごとの印。この体数では「どの列がどの派生にも出る共通駒か」「どの列が選ぶ枠か」が
           * 体数ごとに変わるので、グループの頭で一度だけ示す。文字では言わない。
           */}
          <div
            className="lanes bg-black/20 px-4 pb-2"
            style={{ '--lane-n': g.lanes.length } as CSSProperties}
          >
            {g.lanes.map((lane, i) => (
              <div
                key={i}
                className={`lane__mark ${lane.fixed === null ? 'lane__mark--pick' : ''}`}
              />
            ))}
          </div>

          {g.derivs.map((d) => (
            <DerivRow
              key={`${d.comp.units.join(',')}|${d.row.used.join(',')}`}
              stats={stats}
              deriv={d}
              lanes={g.lanes}
              cohort={cohort}
              showEmblems={family.mixedEmblems}
              dim={dimLowSample && d.row.n <= DIM_SAMPLE_MAX}
              lang={lang}
            />
          ))}
        </div>
      ))}
    </div>
  )

  /** 「Top4率 88.9〜100.0 中央 96.4」。中央値を強調し、幅は淡く添える。 */
  function span(label: string, s: Span, fmt: (x: number) => string) {
    return (
      <span key={label} className="inline-flex items-baseline gap-1">
        <span className="text-faint">{label}</span>
        <b className="text-[13px] font-bold text-ink">{fmt(s.median)}</b>
        {s.min !== s.max && (
          <span className="text-faint/70">
            {t(lang, 'statRange', { min: fmt(s.min), max: fmt(s.max) })}
          </span>
        )}
      </span>
    )
  }
}

const pct = (x: number) => `${x.toFixed(1)}%`
