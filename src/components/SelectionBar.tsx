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
}

export function SelectionBar({ emblems, counts, lang, onClear, onRemove }: SelectionBarProps) {
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
          return (
            <Tip key={emblem.api} label={`${label} — ${t(lang, 'removeHint')}`}>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="group flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 transition-all hover:border-gold/50 hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
              >
                <img src={emblem.icon} alt={label} loading="lazy" className="h-7 w-7 object-contain transition-transform group-hover:scale-110" />
                <span className="text-sm font-bold text-gold">×{count}</span>
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

