import type { CompStats, StatsFile } from '../../shared/types'
import type { Lane, LaneUse } from '../lib/backbone'
import { costBorder, starColor } from '../lib/format'
import { pickName, type Lang } from '../lib/i18n'
import { RecipeLabel } from './RecipeLabel'
import { Tip } from './Tip'

interface LaneUnitProps {
  stats: StatsFile
  lane: Lane
  use: LaneUse
  /** この派生の盤面。列のユニットが居なければ空きマスになる。 */
  comp: CompStats
  /** unitIdx → この行で持たせている紋章。 */
  holders: Map<number, number[]>
  lang: Lang
}

/**
 * 列そろえの盤面のマス1つ。
 *
 * **アイテムも紋章の装備者も、必ずこの行のものを描く。** 同じ系統でも派生によって
 * 装備者そのものが変わる（実データで確認済み）ので、系統の見出しで代表させると嘘になる。
 * ユニットの名前は列見出しが出すので、ここでは出さない。
 */
export function LaneUnit({ stats, lane, use, comp, holders, lang }: LaneUnitProps) {
  const { units, emblems, items } = stats
  const pick = !use.fixed && !use.absent

  const pos = comp.units.indexOf(lane.unitIdx)
  const unit = units[lane.unitIdx]

  // 空きマス。「この派生では取らなかった枠」と「この体数では使わない駒」を描き分ける。
  if (pos < 0 || !unit) {
    return (
      <div className={pick ? 'lane--pick' : undefined}>
        <div className={`lane__box lane__hole ${use.absent ? 'lane__hole--none' : ''}`} />
      </div>
    )
  }

  const unitName = pickName(lang, unit)
  const star = comp.unitStars?.[pos] ?? 0
  const unitItems = comp.unitItems
    .filter((ui) => ui[0] === lane.unitIdx)
    .map((ui) => items?.[ui[1]])
    .filter(Boolean)
  const held = (holders.get(lane.unitIdx) ?? []).map((ei) => emblems[ei]).filter(Boolean)

  return (
    <div className={`flex flex-col items-center gap-0.5 ${pick ? 'lane--pick' : ''}`}>
      {/* 星は列の幅からはみ出させない。はみ出すと隣の列と繋がって帯に見え、列そろえが壊れる。 */}
      <div
        className={`h-3 w-full overflow-hidden text-center text-[10px] leading-none tracking-tighter ${starColor(star)}`}
      >
        {star > 0 ? '★'.repeat(star) : ''}
      </div>
      <div className="relative">
        <Tip label={star > 0 ? `${unitName} ★${star}` : unitName}>
          <img
            src={unit.icon}
            alt={unitName}
            loading="lazy"
            className={`lane__box rounded-lg border-2 object-cover ${costBorder(unit.cost)}`}
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
      <div className="flex h-[var(--lane-item)] w-full justify-center gap-px">
        {unitItems.slice(0, 3).map((it) => (
          <Tip key={it!.api} label={<RecipeLabel label={pickName(lang, it!)} recipe={it!.recipe} />}>
            <img
              src={it!.icon}
              alt=""
              loading="lazy"
              className="lane__item rounded border border-base bg-base object-cover"
            />
          </Tip>
        ))}
      </div>
    </div>
  )
}
