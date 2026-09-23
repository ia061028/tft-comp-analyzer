import type { UnitInfo } from '../../shared/types'
import { pickName, t, type Lang } from '../lib/i18n'
import { unitsByCost, type UnitMark, type UnitMarks } from '../lib/unitFilter'
import { Tip } from './Tip'

interface UnitGridProps {
  units: UnitInfo[]
  marks: UnitMarks
  lang: Lang
  /** クリック: 印を1つ進める（印なし → 使う → 使わない → 印なし）。 */
  onCycle: (api: string) => void
  /** 右クリック／キー操作(Backspace,Delete,-): 印を外す。 */
  onUnmark: (api: string) => void
}

function markLabel(lang: Lang, name: string, mark: UnitMark | undefined): string {
  if (mark === 'use') return `${name} ${t(lang, 'unitUse')}`
  if (mark === 'avoid') return `${name} ${t(lang, 'unitAvoid')}`
  return name
}

/** チャンピオン1体のタイル。レールの格子とモバイルのドックの帯で共用する。 */
export function UnitTile({
  unit,
  mark,
  lang,
  onCycle,
  onUnmark,
}: {
  unit: UnitInfo
  mark: UnitMark | undefined
  lang: Lang
  onCycle: (api: string) => void
  onUnmark: (api: string) => void
}) {
  const name = pickName(lang, unit)
  return (
    <button
      type="button"
      data-cost={unit.cost}
      aria-label={markLabel(lang, name, mark)}
      onClick={() => onCycle(unit.api)}
      onContextMenu={(e) => {
        e.preventDefault()
        onUnmark(unit.api)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '-') {
          e.preventDefault()
          onUnmark(unit.api)
        }
      }}
      className={`utile ${mark === 'use' ? 'utile--use' : mark === 'avoid' ? 'utile--avoid' : ''}`}
    >
      <img src={unit.icon} alt="" loading="lazy" />
    </button>
  )
}

/**
 * チャンピオンの選択面。紋章の EmblemGrid と同じ場所（デスクトップのレール、モバイルのシート）に出る。
 *
 * 段はコスト別。見出しは置かず、枠のコスト色と段の切れ目で読ませる。
 */
export function UnitGrid({ units, marks, lang, onCycle, onUnmark }: UnitGridProps) {
  return (
    <div className="ugrid">
      {unitsByCost(units, lang).map((row) => (
        <div key={row[0].cost} className="ugrid__row">
          {row.map((unit) => (
            <Tip key={unit.api} label={markLabel(lang, pickName(lang, unit), marks.get(unit.api))}>
              <UnitTile
                unit={unit}
                mark={marks.get(unit.api)}
                lang={lang}
                onCycle={onCycle}
                onUnmark={onUnmark}
              />
            </Tip>
          ))}
        </div>
      ))}
    </div>
  )
}
