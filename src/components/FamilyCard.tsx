import { useState } from 'react'
import type { StatsFile } from '../../shared/types'
import type { Family } from '../lib/backbone'
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

  // 既定は最良の派生を含むグループだけ開く（groups は体数の降順、derivs は指標の順）。
  const bestUnits = groups.reduce(
    (best, g) => (g.derivs[0].rank < best.derivs[0].rank ? g : best),
    groups[0],
  ).units
  const [open, setOpen] = useState<Set<number>>(new Set([bestUnits]))
  const toggle = (u: number) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(u)) next.delete(u)
      else next.add(u)
      return next
    })

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

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {/* ───── 背骨パネル: この系統に共通するユニット・装備者・アイテム・特性を1回だけ ───── */}
      <div className="border-b-2 border-line bg-gradient-to-b from-gold/[0.06] to-black/20 px-4 py-3">
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
            // スター・アイテムは系統の最良行のものを使う（背骨は共通ユニットなので代表値でよい）。
            const best = family.groups[0].derivs[0].comp
            const pos = best.units.indexOf(unitIdx)
            const star = pos >= 0 ? (best.unitStars?.[pos] ?? 0) : 0
            const unitItems = best.unitItems
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

      {/* ───── 体数グループ（アコーディオン）。グループ間に線を引かない ───── */}
      {groups.map((g) => {
        const isOpen = open.has(g.units)
        return (
          <div key={g.units}>
            <button
              type="button"
              onClick={() => toggle(g.units)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2.5 border-t border-line bg-black/20 px-4 py-2.5 text-left transition-colors hover:bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/50"
            >
              <svg
                className={`h-3 w-3 shrink-0 text-faint transition-transform duration-150 ${
                  isOpen ? 'rotate-90' : ''
                }`}
                viewBox="0 0 12 12"
                fill="currentColor"
                aria-hidden
              >
                <path d="M4 2l5 4-5 4z" />
              </svg>
              <span className="text-[15px] font-extrabold text-ink">
                {t(lang, 'unitsGroup', { n: g.units })}
              </span>
              <span className="text-[11px] text-faint">{t(lang, 'compareWithin')}</span>
              <span className="ml-auto text-[11px] text-faint tabular-nums">
                {t(lang, 'derivCount', { n: g.derivs.length })}
              </span>
            </button>
            {isOpen &&
              g.derivs.map((d) => (
                <DerivRow
                  key={`${d.comp.units.join(',')}|${d.row.used.join(',')}`}
                  stats={stats}
                  deriv={d}
                  cohort={cohort}
                  lang={lang}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
