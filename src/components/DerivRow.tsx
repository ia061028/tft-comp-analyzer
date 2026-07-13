import { useState } from 'react'
import type { StatsFile } from '../../shared/types'
import type { Deriv } from '../lib/backbone'
import { buildPlannerCode, costBorder, holderMap, starColor, tierOfEdge, LOW_SAMPLE } from '../lib/format'
import { pickName, t, type Lang } from '../lib/i18n'
import { RecipeLabel } from './RecipeLabel'
import { Tip } from './Tip'

interface DerivRowProps {
  stats: StatsFile
  deriv: Deriv
  /** 同ユニット数コホートの平均順位。平均順位の**色**の根拠にだけ使う（数値は出さない）。 */
  cohort: Map<number, number>
  lang: Lang
}

/**
 * 背骨からの派生1行。「＋この駒を足す」だけを見せる。
 *
 * 背骨（＝共通ユニット・装備者・アイテム・特性）は FamilyCard が1回描いているので、
 * ここでは差分だけを描く。9枚のアイコンを見比べる作業を「あと1〜2体を選ぶ」に縮めるのが目的。
 *
 * 平均順位の色は**同じ体数のコホートからの差**で切る（`tierOfEdge`）。絶対値だと 10体グループが
 * 全部 S（同じ赤）になり、色が情報を運ばなくなるため。差の数値は画面に出さない。
 */
export function DerivRow({ stats, deriv, cohort, lang }: DerivRowProps) {
  const { units, emblems, items } = stats
  const { comp, row, adds, removes } = deriv
  const [copied, setCopied] = useState(false)

  const unitCount = comp.units.length
  const avgPlace = row.n > 0 ? row.p / row.n : NaN
  const hasPlace = Number.isFinite(avgPlace)
  const tier = hasPlace
    ? tierOfEdge(avgPlace, unitCount, cohort)
    : { label: '?', color: '#707682', classes: '' }

  const top4Rate = row.n > 0 ? (row.top4 / row.n) * 100 : 0
  const winRate = row.n > 0 ? (row.win / row.n) * 100 : 0
  const lowSample = row.n < LOW_SAMPLE

  const holders = holderMap(comp, row.used)
  const code = buildPlannerCode(comp.units, units, stats.setNumber)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボード不可（権限等）の場合は無視。
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5 transition-colors hover:bg-surface-2/40">
      {/* 差分: ＋追加ユニット / −欠落 */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-sm font-extrabold leading-none text-muted ring-1 ring-line-strong"
          aria-hidden
        >
          +
        </span>

        {adds.map((unitIdx, i) => {
          const unit = units[unitIdx]
          if (!unit) return null
          const unitName = pickName(lang, unit)
          const pos = comp.units.indexOf(unitIdx)
          const star = comp.unitStars?.[pos] ?? 0
          const unitItems = comp.unitItems
            .filter((ui) => ui[0] === unitIdx)
            .map((ui) => items?.[ui[1]])
            .filter(Boolean)
          const held = (holders.get(unitIdx) ?? []).map((ei) => emblems[ei]).filter(Boolean)

          return (
            <div key={`${unitIdx}-${i}`} className="flex w-[46px] flex-col items-center gap-0.5">
              <div className={`h-3 text-[10px] leading-none tracking-[1px] ${starColor(star)}`}>
                {star > 0 ? '★'.repeat(star) : ''}
              </div>
              <div className="relative">
                <Tip label={star > 0 ? `${unitName} ★${star}` : unitName}>
                  <img
                    src={unit.icon}
                    alt={unitName}
                    loading="lazy"
                    className={`h-[42px] w-[42px] shrink-0 rounded-lg border-2 object-cover ${costBorder(unit.cost)}`}
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
                          className="h-[18px] w-[18px] shrink-0 rounded bg-base object-contain ring-2 ring-gold"
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
              <span className="max-w-[46px] truncate text-[9px] leading-none text-muted">{unitName}</span>
            </div>
          )
        })}

        {adds.length === 0 && (
          <span className="text-[11px] text-faint">{t(lang, 'derivBackboneOnly')}</span>
        )}

        {/* 欠落: 背骨にあるのにこの盤面には居ないユニット */}
        {removes.map((unitIdx) => {
          const unit = units[unitIdx]
          if (!unit) return null
          const unitName = pickName(lang, unit)
          return (
            <div key={`r${unitIdx}`} className="flex w-[46px] flex-col items-center gap-0.5 opacity-60">
              <div className="h-3 text-[10px] leading-none text-faint">−</div>
              <Tip label={`${unitName} — ${t(lang, 'missing')}`}>
                <img
                  src={unit.icon}
                  alt=""
                  loading="lazy"
                  className="h-[42px] w-[42px] shrink-0 rounded-lg border-2 border-dashed border-faint object-cover grayscale"
                />
              </Tip>
              <div className="h-[15px]" />
              <span className="max-w-[46px] truncate text-[9px] leading-none text-faint line-through">
                {unitName}
              </span>
            </div>
          )
        })}
      </div>

      {/* 平均順位（色 = 同体数コホートからの差） */}
      <span
        className="shrink-0 text-[22px] font-extrabold leading-none tabular-nums"
        style={{ color: tier.color }}
        title={t(lang, 'avgPlace')}
      >
        {hasPlace ? avgPlace.toFixed(2) : '—'}
      </span>

      {/* Top4 / 1位 / 採用 */}
      <div className="w-[86px] shrink-0 text-[11px] leading-tight">
        <div className="text-faint">
          {t(lang, 'metricTop4')} <b className="text-ink tabular-nums">{top4Rate.toFixed(1)}%</b>
        </div>
        <div className="text-faint">
          {t(lang, 'metricWin')} <b className="text-ink tabular-nums">{winRate.toFixed(1)}%</b>
        </div>
        <div className="text-faint">
          {t(lang, 'metricSample')}{' '}
          {lowSample ? (
            <Tip label={t(lang, 'lowSampleTitle', { n: LOW_SAMPLE })}>
              <b className="cursor-help font-extrabold text-bronze tabular-nums">
                {row.n} {t(lang, 'lowSample')}
              </b>
            </Tip>
          ) : (
            <b className="text-ink tabular-nums">{row.n}</b>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={copy}
        title={t(lang, 'copyCodeTitle')}
        aria-label={t(lang, 'copyCode')}
        className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
          copied ? 'bg-[#6fc06a] text-[#0f1a10]' : 'bg-ink text-base hover:bg-white'
        }`}
      >
        {copied ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  )
}
