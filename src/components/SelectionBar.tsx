import type { EmblemInfo } from '../../shared/types'
import { pickName, type Lang } from '../lib/i18n'

interface SelectionBarProps {
  emblems: EmblemInfo[]
  /** emblems 配列インデックス → 選択個数 */
  counts: number[]
  lang: Lang
  onClear: () => void
}

export function SelectionBar({ emblems, counts, lang, onClear }: SelectionBarProps) {
  const selected = counts
    .map((count, index) => ({ count, index }))
    .filter((x) => x.count > 0)

  if (selected.length === 0) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-400">
        紋章を選択すると、その紋章を使う構成が表示されます
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {selected.map(({ count, index }) => {
          const emblem = emblems[index]
          const label = pickName(lang, emblem)
          return (
            <span
              key={emblem.api}
              title={label}
              className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-1"
            >
              <img
                src={emblem.icon}
                alt={label}
                loading="lazy"
                className="h-7 w-7 object-contain"
              />
              <span className="text-sm font-semibold text-amber-300">×{count}</span>
            </span>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto shrink-0 rounded border border-zinc-700 px-2 py-1 text-sm text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
      >
        クリア
      </button>
    </div>
  )
}
