import type { EmblemInfo } from '../../shared/types'

interface EmblemGridProps {
  emblems: EmblemInfo[]
  /** emblems 配列インデックス → 選択個数 */
  counts: number[]
  /** 左クリック: 選択個数 +1 */
  onAdd: (index: number) => void
  /** 右クリック: 選択個数 -1（0未満にしない） */
  onRemove: (index: number) => void
}

export function EmblemGrid({ emblems, counts, onAdd, onRemove }: EmblemGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">
      {emblems.map((emblem, i) => {
        const count = counts[i] ?? 0
        const selected = count > 0
        return (
          <button
            key={emblem.api}
            type="button"
            title={emblem.name}
            onClick={() => onAdd(i)}
            onContextMenu={(e) => {
              e.preventDefault()
              onRemove(i)
            }}
            className={`relative flex items-center justify-center rounded-md border p-1 transition-colors ${
              selected
                ? 'border-amber-400 bg-amber-400/10 ring-1 ring-amber-400/50'
                : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-500 hover:bg-zinc-800'
            }`}
          >
            <img
              src={emblem.icon}
              alt={emblem.name}
              loading="lazy"
              className="h-12 w-12 object-contain"
            />
            {selected && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-xs font-bold text-zinc-950">
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
