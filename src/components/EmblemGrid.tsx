import type { EmblemInfo } from '../../shared/types'
import { pickName, t, type Lang } from '../lib/i18n'
import { RecipeLabel } from './RecipeLabel'
import { Tip } from './Tip'

interface EmblemGridProps {
  emblems: EmblemInfo[]
  /** emblems 配列インデックス → 選択個数 */
  counts: number[]
  lang: Lang
  /** クリック: 選択個数 +1 */
  onAdd: (index: number) => void
  /** Shift+クリック／右クリック／キー操作(Backspace,Delete,-): 選択個数 -1（0未満にしない） */
  onRemove: (index: number) => void
  /** 合成素材アイテムアイコン（カテゴリヘッダ用） */
  baseItemIcons?: { spatula: string; fryingPan: string }
}

type EmblemBase = 'spatula' | 'fryingpan' | 'none'

const GROUPS: EmblemBase[] = ['spatula', 'fryingpan', 'none']

export function EmblemGrid({ emblems, counts, lang, onAdd, onRemove, baseItemIcons }: EmblemGridProps) {
  const indexed = emblems.map((emblem, i) => ({ emblem, i }))

  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((group) => {
        const members = indexed.filter((x) => (x.emblem.base ?? 'none') === group)
        if (members.length === 0) return null

        return (
          <div key={group}>
            {/* セクション見出し */}
            <div className="mb-2 flex items-center gap-1.5 border-l-2 border-gold/50 pl-2 text-xs font-bold uppercase tracking-wide text-muted">
              {group === 'spatula' && baseItemIcons?.spatula && (
                <img src={baseItemIcons.spatula} alt="" className="h-4 w-4 object-contain" />
              )}
              {group === 'fryingpan' && baseItemIcons?.fryingPan && (
                <img src={baseItemIcons.fryingPan} alt="" className="h-4 w-4 object-contain" />
              )}
              <span>
                {group === 'spatula'
                  ? t(lang, 'emblemCatSpatula')
                  : group === 'fryingpan'
                    ? t(lang, 'emblemCatPan')
                    : t(lang, 'emblemCatNone')}
              </span>
            </div>

            {/* Emblem grid for this group */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">
              {members.map(({ emblem, i }) => {
                const count = counts[i] ?? 0
                const selected = count > 0
                const label = pickName(lang, emblem)
                const ariaLabel = selected ? `${label} ${count}` : label

                return (
                  <Tip
                    key={emblem.api}
                    label={
                      <div className="flex flex-col items-center gap-1">
                        <RecipeLabel label={label} recipe={emblem.recipe} />
                        <span className="text-[10px] text-faint">{t(lang, 'emblemOpHint')}</span>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={ariaLabel}
                      onClick={(e) => {
                        if (e.shiftKey) onRemove(i)
                        else onAdd(i)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        onRemove(i)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '-') {
                          e.preventDefault()
                          onRemove(i)
                        }
                      }}
                      className={`group relative flex w-full items-center justify-center rounded-md border p-1.5 transition-all duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
                        selected
                          ? 'border-gold/70 bg-gold/10 shadow-[0_0_16px_-4px_var(--color-gold)]'
                          : 'border-line bg-surface-2 hover:border-line-strong hover:bg-line'
                      }`}
                    >
                      <img
                        src={emblem.icon}
                        alt={label}
                        loading="lazy"
                        className={`h-12 w-12 object-contain transition-opacity ${selected ? '' : 'opacity-85 group-hover:opacity-100'}`}
                      />
                      {selected && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-xs font-black text-base shadow-md ring-2 ring-surface">
                          {count}
                        </span>
                      )}
                    </button>
                  </Tip>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
