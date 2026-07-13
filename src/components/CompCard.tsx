import { useState } from 'react'
import type { CompStats, StatsFile } from '../../shared/types'
import type { CompRow } from '../lib/multiset'
import {
  activeTier,
  buildPlannerCode,
  costBorder,
  holderMap,
  starColor,
  styleClasses,
  tierOf,
  LOW_SAMPLE,
} from '../lib/format'
import { pickName, t, type Lang } from '../lib/i18n'
import { RecipeLabel } from './RecipeLabel'
import { Tip } from './Tip'

export type SortKey = 'place' | 'top4' | 'win' | 'adopt'

interface CompCardProps {
  stats: StatsFile
  comp: CompStats
  row: CompRow
  /** 選択紋章の総数（一致数バッジの分母）。 */
  total: number
  /** 発動特性数（CompList で算出済み。盤面所持 ＋ 活用紋章の付与分）。 */
  traitCount: Map<number, number>
  /** 生涯ブロンズ数（CompList で算出済み）。 */
  bronze: number
  sortKey: SortKey
  lang: Lang
  bronzeMode?: boolean
  /** 「活用紋章 n/k」を出すか。「すべて使う」ON のときは全行 k/k になるので出さない。 */
  showUtilization: boolean
}

/**
 * 構成一覧の1カード（案 1a: 統計先頭・左レール）。
 *
 * 読み出し開始点（左）に「強さ」、右端に「行動」を置く。数十秒での判断が前提なので、
 * 「良いか → 信頼できるか → 組めるか → コピー」の順に視線が流れるように配置する。
 *
 * 色は1ゾーン1意味:
 *   ティア色 = 強さ（バッジと平均順位の数字だけ）
 *   コスト色 = ユニット枠だけ
 *   金       = 紋章／装備者だけ
 *   反転     = コピー（唯一の行動）
 */
export function CompCard({
  stats,
  comp,
  row,
  total,
  traitCount,
  bronze,
  sortKey,
  lang,
  bronzeMode,
  showUtilization,
}: CompCardProps) {
  const { traits, units, emblems, items } = stats
  const [copied, setCopied] = useState(false)

  // 装備者の割り当て（unitIdx → 載せている紋章）。詳細は format.ts の holderMap。
  const holderEmblems = holderMap(comp, row.used)

  const avgPlace = row.n > 0 ? row.p / row.n : NaN
  const hasPlace = Number.isFinite(avgPlace)
  const tier = hasPlace
    ? tierOf(avgPlace)
    : { label: '?', color: '#707682', classes: 'bg-line-strong text-muted' }
  const code = buildPlannerCode(comp.units, units, stats.setNumber)

  const winRate = row.n > 0 ? (row.win / row.n) * 100 : 0
  const top4Rate = row.n > 0 ? (row.top4 / row.n) * 100 : 0
  // サンプルが薄い行は成績が大きくブレる（採用6件の Top4率 100% は珍しくない）。
  const lowSample = row.n < LOW_SAMPLE

  // 選択紋章が付与する特性。これがこの構成を選ぶ理由なので、他の特性と区別して先頭に出す。
  const emblemTraits = new Set(
    row.used.map((ei) => emblems[ei]?.trait).filter((x): x is number => x != null),
  )

  const bronzeCount = bronzeMode ? bronze : 0
  // 活性トレイトのみ（発動数 >= 最小ブレークポイント）。[traitIdx, style, 発動段]
  const traitChips: [number, number, number][] = []
  for (const [ti, count] of traitCount) {
    const tr = traits[ti]
    if (!tr) continue
    const at = activeTier(count, tr.tiers)
    if (!at) continue
    traitChips.push([ti, at.style, at.min])
  }
  // 紋章由来を先頭に、その後は発動ティアの高い順。
  traitChips.sort(
    (a, b) =>
      Number(emblemTraits.has(b[0])) - Number(emblemTraits.has(a[0])) ||
      b[1] - a[1] ||
      (traits[a[0]].name < traits[b[0]].name ? -1 : 1),
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // クリップボード不可（権限等）の場合は無視。
    }
  }

  /** 統計セル。現在のソート対象を金でハイライト。 */
  const stat = (active: boolean, label: string, value: string, extra?: React.ReactNode) => (
    <div className="flex flex-col">
      <span className="text-[11px] leading-tight text-faint">{label}</span>
      <span
        className={`flex items-center gap-1.5 text-[17px] font-bold leading-tight tabular-nums ${
          active ? 'text-gold' : 'text-ink'
        }`}
      >
        {value}
        {extra}
      </span>
    </div>
  )

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-all duration-150 hover:border-line-strong hover:shadow-lg hover:shadow-black/30 sm:flex-row">
      {/* ───── 左レール: 強さ（ティア + 平均順位）。読み出し開始点に判断材料を置く ───── */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-line bg-black/20 px-4 py-3 sm:w-[132px] sm:flex-col sm:justify-center sm:gap-2 sm:border-b-0 sm:border-r sm:py-4"
        style={{ borderLeft: `3px solid ${tier.color}` }}
      >
        <span
          className={`${tier.classes} flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[22px] font-extrabold shadow-sm`}
        >
          {tier.label}
        </span>
        <div className="flex flex-col sm:items-center">
          <span className="text-[11px] leading-none text-faint">{t(lang, 'avgPlace')}</span>
          <span
            className="text-[34px] font-extrabold leading-none tabular-nums"
            style={{ color: tier.color }}
          >
            {hasPlace ? avgPlace.toFixed(2) : '—'}
          </span>
        </div>
      </div>

      {/* ───── 中央: 統計行 → 盤面 → 特性 ───── */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 px-4 py-3.5">
        {/* 統計行（信頼できるか） */}
        <div className="flex items-center gap-6">
          {stat(sortKey === 'top4', t(lang, 'metricTop4'), `${top4Rate.toFixed(1)}%`)}
          {stat(sortKey === 'win', t(lang, 'metricWin'), `${winRate.toFixed(1)}%`)}
          {stat(
            sortKey === 'adopt',
            t(lang, 'metricSample'),
            `${row.n}`,
            lowSample ? (
              <Tip label={t(lang, 'lowSampleTitle', { n: LOW_SAMPLE })}>
                <span className="cursor-help text-[11px] font-bold text-bronze">
                  {t(lang, 'lowSample')}
                </span>
              </Tip>
            ) : null,
          )}
          {showUtilization && (
            <div className="flex flex-col">
              <span className="text-[11px] leading-tight text-faint">{t(lang, 'utilizationLabel')}</span>
              <span
                title={t(lang, 'utilizationTitle')}
                className="text-[17px] font-bold leading-tight text-ink tabular-nums"
              >
                {row.match}/{total}
              </span>
            </div>
          )}
          {bronzeMode && (
            <div className="flex flex-col">
              <span className="text-[11px] leading-tight text-faint">{t(lang, 'bronzeMode')}</span>
              <span className="text-[17px] font-bold leading-tight text-bronze tabular-nums">
                {bronzeCount}
              </span>
            </div>
          )}
        </div>

        {/* 盤面（組めるか）。装備者は金リング + 紋章バッジ + ラベルで主役化する */}
        <div className="flex flex-wrap gap-x-2 gap-y-3">
          {comp.units.map((unitIdx, pos) => {
            const unit = units[unitIdx]
            if (!unit) return null
            const unitName = pickName(lang, unit)
            const star = comp.unitStars?.[pos] ?? 0
            const unitItems = comp.unitItems
              .filter((ui) => ui[0] === unitIdx)
              .map((ui) => items?.[ui[1]])
              .filter(Boolean)
            // このユニットが載せている「選択紋章」。複数紋章を選んだ場合、
            // どの紋章をどのユニットに載せるかを判別できるよう、実際の紋章アイコンを出す。
            const heldEmblems = (holderEmblems.get(unitIdx) ?? [])
              .map((ei) => emblems[ei])
              .filter(Boolean)
            const isHolder = heldEmblems.length > 0

            return (
              <div key={unitIdx} className="flex w-[54px] flex-col items-center gap-0.5">
                <div className={`h-3 text-[11px] leading-none tracking-[1px] ${starColor(star)}`}>
                  {star > 0 ? '★'.repeat(star) : ''}
                </div>

                <div className="relative">
                  <Tip label={star > 0 ? `${unitName} ★${star}` : unitName}>
                    <img
                      src={unit.icon}
                      alt={unitName}
                      loading="lazy"
                      className={`h-[50px] w-[50px] shrink-0 rounded-[9px] border-2 object-cover ${costBorder(unit.cost)}`}
                      style={
                        isHolder
                          ? { boxShadow: '0 0 0 2px var(--color-gold), 0 0 14px rgba(232,183,92,.5)' }
                          : undefined
                      }
                    />
                  </Tip>
                  {/* 紋章バッジ（右上）。複数紋章なら複数出る＝どれをどこに載せるかが分かる */}
                  {heldEmblems.length > 0 && (
                    <div className="absolute -right-1.5 -top-1.5 z-10 flex gap-0.5">
                      {heldEmblems.map((e, i) => (
                        <Tip key={i} label={<RecipeLabel label={pickName(lang, e!)} recipe={e!.recipe} />}>
                          <img
                            src={e!.icon}
                            alt=""
                            loading="lazy"
                            className="h-[21px] w-[21px] shrink-0 rounded-md bg-base object-contain ring-2 ring-gold"
                          />
                        </Tip>
                      ))}
                    </div>
                  )}
                </div>

                {/* 完成アイテム（アイコンの下。本番の可読性をそのまま維持） */}
                <div className="flex h-[17px] justify-center gap-[1px]">
                  {unitItems.slice(0, 3).map((it) => (
                    <Tip key={it!.api} label={<RecipeLabel label={pickName(lang, it!)} recipe={it!.recipe} />}>
                      <img
                        src={it!.icon}
                        alt=""
                        loading="lazy"
                        className="h-[17px] w-[17px] shrink-0 rounded border border-base bg-base object-cover"
                      />
                    </Tip>
                  ))}
                </div>

                {isHolder && (
                  <span className="text-[9px] font-extrabold leading-none tracking-wide text-gold">
                    {t(lang, 'holderTag')}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* 特性（紋章由来を主役に、残りは従に） */}
        <div className="flex flex-wrap items-center gap-1.5">
          {traitChips.map(([traitIdx, style, count]) => {
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

      {/* ───── 右: 唯一の行動（コピー）。反転ニュートラルで CTA と分かるようにする ───── */}
      <div className="flex shrink-0 items-center border-t border-line bg-black/10 px-4 py-3 sm:w-[148px] sm:border-l sm:border-t-0">
        <button
          type="button"
          onClick={copy}
          title={t(lang, 'copyCodeTitle')}
          className={`flex h-[46px] w-full items-center justify-center gap-2 rounded-[10px] text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
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
          {copied ? t(lang, 'copied') : t(lang, 'copyCode')}
        </button>
      </div>
    </div>
  )
}
