import { useEffect, useRef } from 'react'
import type { EmblemInfo } from '../../shared/types'
import { EmblemGrid } from './EmblemGrid'
import { pickName, t, type Lang } from '../lib/i18n'

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
}: EmblemDockProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const selectedCount = counts.reduce((a, b) => a + b, 0)
  const picked = counts.map((count, index) => ({ count, index })).filter((x) => x.count > 0)

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
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-muted"
          >
            {picked.length > 0 ? (
              <>
                {picked.slice(0, 4).map(({ index }) => {
                  const e = emblems[index]
                  if (!e) return null
                  return <img key={index} src={e.icon} alt={pickName(lang, e)} loading="lazy" />
                })}
                <span className="truncate font-semibold text-ink">
                  {t(lang, 'emblems')} <span className="text-gold">{selectedCount}</span>
                </span>
              </>
            ) : (
              <span>{t(lang, 'openEmblems')}</span>
            )}
          </button>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-xs font-medium text-faint"
            >
              {t(lang, 'clear')}
            </button>
          )}
        </div>

        {/* 19種を横帯で。シートを開かずに1タップで切り替えられるのがこの帯の役目。 */}
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
            aria-label={t(lang, 'emblems')}
            tabIndex={-1}
            className="sheet focus-visible:outline-none"
          >
            <div className="sheet__grip" aria-hidden />
            <div className="sheet__body">
              <EmblemGrid
                emblems={emblems}
                counts={counts}
                lang={lang}
                onAdd={onAdd}
                onRemove={onRemove}
                baseItemIcons={baseItemIcons}
                maxMult={maxMult}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}
