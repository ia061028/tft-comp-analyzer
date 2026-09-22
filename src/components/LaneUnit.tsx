import type { CSSProperties } from 'react'
import type { CompStats, StatsFile, TraitGrant } from '../../shared/types'
import { costBorder, grantChoicesTip, starColor } from '../lib/format'
import { pickName, type Lang } from '../lib/i18n'
import { RecipeLabel } from './RecipeLabel'
import { Tip } from './Tip'

interface LaneUnitProps {
  stats: StatsFile
  /** この列にこの派生が置く駒。空きマスなら -1。 */
  unitIdx: number
  /** 選ぶ枠の列か（＝派生ごとに中身が変わる列）。 */
  pick: boolean
  /** この派生の盤面。星とアイテムをここから引く。 */
  comp: CompStats
  /** unitIdx → この行で持たせている紋章。 */
  holders: Map<number, number[]>
  /** この駒が持ち込む上乗せ特性の選択の割れ方（share 降順）。吹き出しにだけ出す。 */
  choices?: TraitGrant[]
  lang: Lang
}

/**
 * 列そろえの盤面のマス1つ。
 *
 * **アイテムも紋章の装備者も、必ずこの行のものを描く。** 同じ系統でも派生によって
 * 装備者そのものが変わる（実データで確認済み）ので、系統の見出しで代表させると嘘になる。
 * ユニットの名前は出さない（列が増えると潰れて読めない）。名前はツールチップで拾う。
 */
export function LaneUnit({ stats, unitIdx, pick, comp, holders, choices = [], lang }: LaneUnitProps) {
  const { units, emblems, items, traits } = stats
  const pos = unitIdx < 0 ? -1 : comp.units.indexOf(unitIdx)
  const unit = unitIdx < 0 ? undefined : units[unitIdx]

  // 空きマス。詰めた結果ここに駒が来なかった選ぶ枠でだけ出る。
  if (pos < 0 || !unit) {
    return (
      <div className={pick ? 'lane--pick' : undefined}>
        <div className="lane__box lane__hole" />
      </div>
    )
  }

  const unitName = pickName(lang, unit)
  const star = comp.unitStars?.[pos] ?? 0
  const unitItems = comp.unitItems
    .filter((ui) => ui[0] === unitIdx)
    .map((ui) => items?.[ui[1]])
    .filter(Boolean)
  const held = (holders.get(unitIdx) ?? []).map((ei) => emblems[ei]).filter(Boolean)
  const shown = unitItems.slice(0, 3)

  return (
    <div className={`flex min-w-0 flex-col items-center gap-0.5 ${pick ? 'lane--pick' : ''}`}>
      <div className={`lane__star ${starColor(star)}`}>{star > 0 ? '★'.repeat(star) : ''}</div>
      {/* w-full が要る。auto 幅だと画像の固有幅が親を広げ、狭い画面で列からはみ出す。 */}
      <div className="relative flex w-full justify-center">
        {/*
         * 寸法は Tip の span（＝実際の flex アイテム）に載せる。img 側に width:100% を書くと
         * 親が中身で決まる span なので幅が決まらず、画像が数pxに潰れる。
         */}
        <Tip
          className="lane__box"
          label={`${star > 0 ? `${unitName} ★${star}` : unitName}${grantChoicesTip(choices, traits, lang)}`}
        >
          <img
            src={unit.icon}
            alt={unitName}
            loading="lazy"
            className={`h-full w-full rounded-lg border-2 object-cover ${costBorder(unit.cost)}`}
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
                  className="lane__badge shrink-0 rounded bg-base object-contain ring-2 ring-gold"
                />
              </Tip>
            ))}
          </div>
        )}
      </div>
      <div
        className="lane__items"
        style={{ '--lane-item-n': shown.length } as CSSProperties}
      >
        {shown.map((it) => (
          <Tip
            key={it!.api}
            className="lane__item"
            label={<RecipeLabel label={pickName(lang, it!)} recipe={it!.recipe} />}
          >
            <img
              src={it!.icon}
              alt=""
              loading="lazy"
              className="h-full w-full rounded border border-base bg-base object-cover"
            />
          </Tip>
        ))}
      </div>
    </div>
  )
}
