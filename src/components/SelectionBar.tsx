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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-400">
        {t(lang, 'selectEmblemHint')}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {selected.map(({ count, index }) => {
          const emblem = emblems[index]
          const label = pickName(lang, emblem)
          return (
            <Tip key={emblem.api} label={`${label} — ${t(lang, 'removeHint')}`}>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="flex items-center gap-1 rounded-lg bg-zinc-800 px-1.5 py-1 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                <img src={emblem.icon} alt={label} loading="lazy" className="h-7 w-7 object-contain" />
                <span className="text-sm font-semibold text-amber-300">×{count}</span>
              </button>
            </Tip>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      >
        {t(lang, 'clear')}
      </button>
    </div>
  )
}
