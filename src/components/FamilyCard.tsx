import type { StatsFile } from '../../shared/types'
import type { Family, Span } from '../lib/backbone'
import { activeTier, costBorder, starColor, styleClasses } from '../lib/format'
import { pickName, t, type Lang } from '../lib/i18n'
import { DerivRow } from './DerivRow'
import { RecipeLabel } from './RecipeLabel'
import { Tip } from './Tip'

interface FamilyCardProps {
  stats: StatsFile
  family: Family
  cohort: Map<number, number>
  lang: Lang
}

/**
 * 1系統 ＝ 背骨パネル（1回だけ）＋ 体数グループのアコーディオン。
 *
 * **体数グループをまたいで線や矢印を引かない。** 8体 → 9体 は「駒を1つ足した改善」ではなく
 * 「9体まで生き残れた人の成績」なので（平均順位は実質ユニット数を測っている）、
 * 親→子の関係として見せると最も誤解を招く。グループは互いに独立した選択肢として並べる。
 * 比較が正当なのは**同じ体数の兄弟の間だけ**。
 */
export function FamilyCard({ stats, family, cohort, lang }: FamilyCardProps) {
  const { traits, units, emblems, items } = stats
  const { backbone, holders, traitCount, used, groups } = family
  // コアユニットのスター・アイテムは系統の最良行のものを代表値として使う。
  const bestComp = groups.flatMap((g) => g.derivs).reduce((a, b) => (a.rank <= b.rank ? a : b)).comp

  // 紋章由来の特性は、この系統を選ぶ理由そのものなので先頭に出して金リングで区別する。
  const emblemTraits = new Set(
    used.map((ei) => emblems[ei]?.trait).filter((x): x is number => x != null),
  )
  const chips: [number, number, number][] = []
  for (const [ti, count] of traitCount) {
    const tr = traits[ti]
    if (!tr) continue
    const at = activeTier(count, tr.tiers)
    if (!at) continue
    chips.push([ti, at.style, at.min])
  }
  chips.sort(
    (a, b) =>
      Number(emblemTraits.has(b[0])) - Number(emblemTraits.has(a[0])) ||
      b[1] - a[1] ||
      (traits[a[0]].name < traits[b[0]].name ? -1 : 1),
  )

  // overflow-hidden は使わない。角丸のためにクリップすると、ユニット上のツールチップが
  // カードの縁で切られて読めなくなる（背骨パネルの1行目が特に潰れる）。角丸は子側で処理する。
  return (
    <div className="rounded-xl border border-line bg-surface">
      {/* ───── コアパネル: この系統に共通するユニット・装備者・アイテム・特性を1回だけ ───── */}
      <div className="rounded-t-xl border-b-2 border-line bg-gradient-to-b from-gold/[0.06] to-black/20 px-4 py-3">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold tracking-wide text-gold">
            {t(lang, 'backbone', { n: backbone.length })}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
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
        </div>

        <div className="mb-2.5 flex flex-wrap gap-x-2 gap-y-2">
          {backbone.map((unitIdx) => {
            const unit = units[unitIdx]
            if (!unit) return null
            const unitName = pickName(lang, unit)
            const pos = bestComp.units.indexOf(unitIdx)
            const star = pos >= 0 ? (bestComp.unitStars?.[pos] ?? 0) : 0
            const unitItems = bestComp.unitItems
              .filter((ui) => ui[0] === unitIdx)
              .map((ui) => items?.[ui[1]])
              .filter(Boolean)
            const held = (holders.get(unitIdx) ?? []).map((ei) => emblems[ei]).filter(Boolean)

            return (
              <div key={unitIdx} className="flex w-[50px] flex-col items-center gap-0.5">
                <div className={`h-3 text-[10px] leading-none tracking-[1px] ${starColor(star)}`}>
                  {star > 0 ? '★'.repeat(star) : ''}
                </div>
                <div className="relative">
                  <Tip label={star > 0 ? `${unitName} ★${star}` : unitName}>
                    <img
                      src={unit.icon}
                      alt={unitName}
                      loading="lazy"
                      className={`h-[46px] w-[46px] shrink-0 rounded-lg border-2 object-cover ${costBorder(unit.cost)}`}
                      style={
                        held.length > 0
                          ? { boxShadow: '0 0 0 2px var(--color-gold), 0 0 12px rgba(232,183,92,.45)' }
                          : undefined
                      }
                    />
                  </Tip>
                  {held.length > 0 && (
                    <div className="absolute -right-1.5 -top-1.5 z-10 flex gap-0.5">
                      {held.map((e, j) => (
                        <Tip key={j} label={<RecipeLabel label={pickName(lang, e!)} recipe={e!.recipe} />}>
                          <img
                            src={e!.icon}
                            alt=""
                            loading="lazy"
                            className="h-[19px] w-[19px] shrink-0 rounded bg-base object-contain ring-2 ring-gold"
                          />
                        </Tip>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex h-[15px] justify-center gap-[1px]">
                  {unitItems.slice(0, 3).map((it) => (
                    <Tip key={it!.api} label={<RecipeLabel label={pickName(lang, it!)} recipe={it!.recipe} />}>
                      <img
                        src={it!.icon}
                        alt=""
                        loading="lazy"
                        className="h-[15px] w-[15px] shrink-0 rounded border border-base bg-base object-cover"
                      />
                    </Tip>
                  ))}
                </div>
                <span className="max-w-[50px] truncate text-[9px] leading-none text-muted">{unitName}</span>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map(([traitIdx, style, count]) => {
            const trait = traits[traitIdx]
            const fromEmblem = emblemTraits.has(traitIdx)
            return (
              <Tip key={traitIdx} label={trait ? pickName(lang, trait) : `#${traitIdx}`}>
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 text-[11px] tabular-nums ${styleClasses(
                    style,
                  )} ${
                    fromEmblem
                      ? 'h-[22px] font-bold ring-1 ring-gold/60'
                      : 'h-[19px] font-semibold opacity-80'
                  }`}
                >
                  {trait?.icon && (
                    <img
                      src={trait.icon}
                      alt=""
                      loading="lazy"
                      className={fromEmblem ? 'h-4 w-4 object-contain' : 'h-3.5 w-3.5 object-contain'}
                    />
                  )}
                  {count ? <span>{count}</span> : null}
                </span>
              </Tip>
            )
          })}
        </div>
      </div>

      {/* ───── 体数グループ。常に開いた状態で出す（畳まない） ───── */}
      {groups.map((g) => (
        <div key={g.units}>
          <div
            title={t(lang, 'compareWithin')}
            className="flex w-full items-center gap-x-3 gap-y-1 border-t border-line bg-black/20 px-4 py-2.5 text-left"
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
          {g.derivs.map((d) => (
            <DerivRow
              key={`${d.comp.units.join(',')}|${d.row.used.join(',')}`}
              stats={stats}
              deriv={d}
              cohort={cohort}
              showEmblems={family.mixedEmblems}
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
