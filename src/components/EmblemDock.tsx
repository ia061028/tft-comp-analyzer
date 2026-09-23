import { Fragment, useEffect, useRef } from 'react'
import type { EmblemInfo, UnitInfo } from '../../shared/types'
import { EmblemGrid } from './EmblemGrid'
import { SegmentedControl } from './SegmentedControl'
import { UnitGrid, UnitTile } from './UnitGrid'
import { pickName, t, type Lang } from '../lib/i18n'
import { unitsByCost, type PickTab, type UnitMark, type UnitMarks } from '../lib/unitFilter'

interface EmblemDockProps {
  emblems: EmblemInfo[]
  /** emblems 配列インデックス → 選択個数 */
  counts: number[]
  lang: Lang
  onAdd: (index: number) => void
  onRemove: (index: number) => void
  onClear: () => void
  baseItemIcons?: { spatula: string; fryingPan: string }
  /** 紋章ごとの最大同時活用枚数。超えた選択はタイルの個数バッジを銅にして知らせる。 */
  maxMult?: number[]
  /** シートが開いているか（状態は App が持つ）。 */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 紋章とチャンピオンのどちらを出しているか（状態は App が持ち、レールと共用）。 */
  tab: PickTab
  onTabChange: (tab: PickTab) => void
  tabOptions: { key: PickTab; label: string }[]
  units: UnitInfo[]
  unitMarks: UnitMarks
  onCycleUnit: (api: string) => void
  onUnmarkUnit: (api: string) => void
  onClearUnits: () => void
}

/**
 * モバイルの紋章選択面。デスクトップの 220px レールに代わる常設ドックと、その展開シート。
 *
 * ドックは画面下に貼り付き、紋章19種を横スクロールの帯で出す。**1タップで切り替えられる速度が
 * 最優先**なので、既定ではシートを開かずに帯から直接選べる。カテゴリ区切り付きの一覧が要るとき
 * だけ、見出しをタップしてシートを開く。
 *
 * 画面が 48rem 以上のときは `.dock` / `.sheet` ごと CSS 側で消える（デスクトップはレールを使う）。
 */
export function EmblemDock({
  emblems,
  counts,
  lang,
  onAdd,
  onRemove,
  onClear,
  baseItemIcons,
  maxMult,
  open,
  onOpenChange,
  tab,
  onTabChange,
  tabOptions,
  units,
  unitMarks,
  onCycleUnit,
  onUnmarkUnit,
  onClearUnits,
}: EmblemDockProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const selectedCount = counts.reduce((a, b) => a + b, 0)
  const picked = counts.map((count, index) => ({ count, index })).filter((x) => x.count > 0)
  // 見出しに出す、印を付けた駒（使う → 使わない の順）。
  const unitByApi = new Map(units.map((u) => [u.api, u]))
  const marked: { unit: UnitInfo; mark: UnitMark }[] = []
  for (const want of ['use', 'avoid'] as const) {
    for (const [api, mark] of unitMarks) {
      const unit = unitByApi.get(api)
      if (unit && mark === want) marked.push({ unit, mark })
    }
  }
  const tabCount = tab === 'emblem' ? selectedCount : marked.length

  // Esc で閉じる。開いた直後にシートへフォーカスを移し、背後の一覧をタブで拾わせない。
  useEffect(() => {
    if (!open) return
    sheetRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <>
      <div className="dock">
        <div className="dock__head">
          <SegmentedControl<PickTab>
            ariaLabel={t(lang, 'emblems')}
            value={tab}
            onChange={onTabChange}
            options={tabOptions}
          />
          {/* 選んだものの顔ぶれ。押すと区切り付きの一覧（シート）を開く。 */}
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            aria-expanded={open}
            aria-label={tab === 'emblem' ? t(lang, 'openEmblems') : t(lang, 'champions')}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-muted"
          >
            {tab === 'emblem'
              ? picked.slice(0, 4).map(({ index }) => {
                  const e = emblems[index]
                  if (!e) return null
                  return <img key={index} src={e.icon} alt={pickName(lang, e)} loading="lazy" />
                })
              : marked.slice(0, 4).map(({ unit, mark }) => (
                  <img
                    key={unit.api}
                    src={unit.icon}
                    alt={pickName(lang, unit)}
                    loading="lazy"
                    className={mark === 'avoid' ? 'dock__avoid' : undefined}
                  />
                ))}
            <svg viewBox="0 0 12 12" aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-faint">
              <path
                d="M2 7.5 6 3.5 10 7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {tabCount > 0 && (
            <button
              type="button"
              onClick={tab === 'emblem' ? onClear : onClearUnits}
              className="shrink-0 text-xs font-medium text-faint"
            >
              {t(lang, 'clear')}
            </button>
          )}
        </div>

        {/* 横帯。シートを開かずに1タップで切り替えられるのがこの帯の役目。駒はコストの切れ目で間を空ける。 */}
        {tab === 'unit' ? (
          <div className="dock__strip">
            {unitsByCost(units, lang).map((row, r) => (
              <Fragment key={row[0].cost}>
                {r > 0 && <span className="dock__gap" aria-hidden />}
                {row.map((unit) => (
                  <UnitTile
                    key={unit.api}
                    unit={unit}
                    mark={unitMarks.get(unit.api)}
                    lang={lang}
                    onCycle={onCycleUnit}
                    onUnmark={onUnmarkUnit}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="dock__strip">
            {emblems.map((emblem, i) => {
              const count = counts[i] ?? 0
              const label = pickName(lang, emblem)
              return (
                <button
                  key={emblem.api}
                  type="button"
                  aria-pressed={count > 0}
                  aria-label={count > 0 ? `${label} ${count}` : label}
                  onClick={() => onAdd(i)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onRemove(i)
                  }}
                  className={`dock__tile relative ${count > 0 ? 'dock__tile--on' : ''}`}
                >
                  <img src={emblem.icon} alt="" loading="lazy" />
                  {count > 0 && (
                    <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-black text-base">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {open && (
        <>
          <button
            type="button"
            aria-label={t(lang, 'closeEmblems')}
            onClick={() => onOpenChange(false)}
            className="sheet__bd"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={tab === 'emblem' ? t(lang, 'emblems') : t(lang, 'champions')}
            tabIndex={-1}
            className="sheet focus-visible:outline-none"
          >
            <div className="sheet__grip" aria-hidden />
            <div className="sheet__body">
              {tab === 'emblem' ? (
                <EmblemGrid
                  emblems={emblems}
                  counts={counts}
                  lang={lang}
                  onAdd={onAdd}
                  onRemove={onRemove}
                  baseItemIcons={baseItemIcons}
                  maxMult={maxMult}
                />
              ) : (
                <UnitGrid
                  units={units}
                  marks={unitMarks}
                  lang={lang}
                  onCycle={onCycleUnit}
                  onUnmark={onUnmarkUnit}
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
