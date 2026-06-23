import type { EmblemInfo } from '../../shared/types'
import { pickName, type Lang } from '../lib/i18n'
import { Tip } from './Tip'

interface EmblemGridProps {
  emblems: EmblemInfo[]
  /** emblems 配列インデックス → 選択個数 */
  counts: number[]
  lang: Lang
  /** 左クリック: 選択個数 +1 */
  onAdd: (index: number) => void
  /** 右クリック: 選択個数 -1（0未満にしない） */
  onRemove: (index: number) => void
  /** 合成素材アイテムアイコン（カテゴリヘッダ用） */
  baseItemIcons?: { spatula: string; fryingPan: string }
}

export function EmblemGrid({ emblems, counts, lang, onAdd, onRemove }: EmblemGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">
      {emblems.map((emblem, i) => {
        const count = counts[i] ?? 0
        const selected = count > 0
        const label = pickName(lang, emblem)
        return (
          <Tip key={emblem.api} label={label}>
            <button
              type="button"
              onClick={() => onAdd(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                onRemove(i)
              }}
              className={`group relative flex w-full items-center justify-center rounded-xl border p-1.5 transition-all duration-200 hover:scale-[1.08] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
                selected
                  ? 'border-amber-400/80 bg-amber-400/10 shadow-[0_0_15px_rgba(251,191,36,0.15)]'
                  : 'border-slate-700/60 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-700/60'
              }`}
            >
              <img
                src={emblem.icon}
                alt={label}
                loading="lazy"
                className="h-12 w-12 object-contain"
              />
              {selected && (
                <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-200/50 bg-gradient-to-br from-amber-300 to-amber-500 px-1 text-xs font-black text-amber-950 shadow-md">
                  {count}
                </span>
              )}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}
