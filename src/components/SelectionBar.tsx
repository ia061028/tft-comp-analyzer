import type { EmblemInfo } from '../../shared/types'
import { pickName, t, type Lang } from '../lib/i18n'
import { Tip } from './Tip'

interface SelectionBarProps {
  emblems: EmblemInfo[]
  /** emblems 配列インデックス → 選択個数 */
  counts: number[]
  lang: Lang
  onClear: () => void
  /** チップのクリックで選択を1つ減らす。 */
  onRemove: (index: number) => void
  /**
   * 紋章 idx → データ上1レコードで同時活用された最大枚数。
   * 選択枚数がこれを超えると「その枚数を活かせる構成はデータに無い」ため警告する
   * （複数選択自体は仕様なのでブロックはしない）。
   */
  maxMult: number[]
}

export function SelectionBar({ emblems, counts, lang, onClear, onRemove, maxMult }: SelectionBarProps) {
  const selected = counts
    .map((count, index) => ({ count, index }))
    .filter((x) => x.count > 0)

  if (selected.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-faint">
        {t(lang, 'selectEmblemHint')}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gold/25 bg-surface px-4 py-2.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {selected.map(({ count, index }) => {
          const emblem = emblems[index]
          const label = pickName(lang, emblem)
          const max = maxMult[index] ?? 0
          const over = count > max
          return (
            <Tip
              key={emblem.api}
              label={
                over
                  ? `${label} — ${t(lang, 'overCapWarn', { n: count, max })}`
                  : `${label} — ${t(lang, 'removeHint')}`
              }
            >
              <button
                type="button"
                onClick={() => onRemove(index)}
                className={`group flex items-center gap-1.5 rounded-md border bg-surface-2 px-2 py-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
                  over
                    ? 'border-bronze/60 hover:border-bronze hover:bg-line'
                    : 'border-line hover:border-gold/50 hover:bg-line'
                }`}
              >
                <img src={emblem.icon} alt={label} loading="lazy" className="h-7 w-7 object-contain transition-transform group-hover:scale-110" />
                <span className={`text-sm font-bold ${over ? 'text-[#e3b6a6]' : 'text-gold'}`}>×{count}</span>
                {over && (
                  <svg
                    className="h-3.5 w-3.5 text-bronze"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0z" />
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                  </svg>
                )}
              </button>
            </Tip>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto shrink-0 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold tracking-wide text-muted transition-colors hover:border-line-strong hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
      >
        {t(lang, 'clear')}
      </button>
    </div>
  )
}

