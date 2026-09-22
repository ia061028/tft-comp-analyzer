import type { CSSProperties } from 'react'
import type { StatsFile } from '../../shared/types'
import type { Family } from '../lib/backbone'
import { DIM_SAMPLE_MAX } from '../lib/format'
import { t, type Lang } from '../lib/i18n'
import { DerivRow } from './DerivRow'

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
 * 列が誰かは駒の顔が語るので、見出しで名前を並べたりはしない。使っている紋章の名前も
 * 出さない。どの駒が何を着けているかは盤面の金色のバッジが示すし、選んだ紋章は
 * 画面上部の選択バーが出している。
 *
 * **見出しはアイテムも紋章の装備者も主張しない。** 同じ系統でも派生によって装備者そのものが
 * 変わる（実データで確認済み）ので、代表値を置くと嘘になる。それらは行ごとに描く。
 *
 * **体数グループをまたいで線や矢印を引かない。** 8体 → 9体 は「駒を1つ足した改善」ではなく
 * 「9体まで生き残れた人の成績」なので（平均順位は実質ユニット数を測っている）、
 * 親→子の関係として見せると最も誤解を招く。比較が正当なのは**同じ体数の兄弟の間だけ**。
 */
export function FamilyCard({ stats, family, cohort, dimLowSample, lang }: FamilyCardProps) {
  const { groups } = family

  // overflow-hidden は使わない。角丸のためにクリップすると、ユニット上のツールチップが
  // カードの縁で切られて読めなくなる。角丸は子側で処理する。
  return (
    <div className="rounded-xl border border-line bg-surface">
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
             * このグループの中央値。**同じ体数の中だけ**で集計しているので、数字が歪まない。
             * 系統全体で集計すると 7体〜10体が混ざり、生存バイアスそのものを見ることになる。
             *
             * 派生が1件のグループでは、この要約は真下の行とまったく同じ数字になるので出さない。
             * 幅（最小〜最大）も出さない。読む数字が倍になるわりに、行を1つずつ見れば分かる。
             * 狭い画面では要約ごと出さない。同じ指標名が1枚のカードに3回出てうるさく、
             * 中央値は真下に並ぶ行そのものから読める。
             */}
            {g.derivs.length > 1 && (
              <span className="hidden flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint tabular-nums md:flex">
                {span(t(lang, 'avgPlace'), g.place.median, (x) => x.toFixed(2))}
                {span(t(lang, 'metricTop4'), g.top4.median, pct)}
                {span(t(lang, 'metricWin'), g.win.median, pct)}
              </span>
            )}

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

  /** 「Top4率 96.4」。ラベルは淡く、値だけを立てる。 */
  function span(label: string, value: number, fmt: (x: number) => string) {
    return (
      <span key={label} className="inline-flex items-baseline gap-1">
        <span className="text-faint">{label}</span>
        <b className="text-[12px] font-bold text-ink">{fmt(value)}</b>
      </span>
    )
  }
}

const pct = (x: number) => `${x.toFixed(1)}%`
