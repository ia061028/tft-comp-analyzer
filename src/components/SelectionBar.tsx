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
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-500 shadow-sm">
        <span aria-hidden>✨</span>
        {t(lang, 'selectEmblemHint')}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-slate-900/80 px-4 py-3 shadow-[0_0_15px_rgba(251,191,36,0.05)]">
      <div className="flex flex-wrap items-center gap-2.5">
        {selected.map(({ count, index }) => {
          const emblem = emblems[index]
          const label = pickName(lang, emblem)
          return (
            <Tip key={emblem.api} label={`${label} — ${t(lang, 'removeHint')}`}>
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="group flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-800/80 px-2 py-1 transition-all hover:border-amber-500/40 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                <img src={emblem.icon} alt={label} loading="lazy" className="h-7 w-7 object-contain transition-transform group-hover:scale-110" />
                <span className="text-sm font-bold text-amber-300">×{count}</span>
              </button>
            </Tip>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      >
        {t(lang, 'clear')}
      </button>
    </div>
  )
}

