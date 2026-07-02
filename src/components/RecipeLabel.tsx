interface RecipeLabelProps {
  label: string
  recipe?: [string, string]
}

/**
 * アイテム/紋章ツールチップの中身。recipe があれば名前＋合成素材2アイコン、
 * なければ label のみを表示する。CompCard（通常/紋章アイテム）と EmblemGrid で共有。
 */
export function RecipeLabel({ label, recipe }: RecipeLabelProps) {
  if (!recipe) return <>{label}</>
  return (
    <div className="flex flex-col items-center gap-1 px-1 py-0.5">
      <span className="font-bold text-[11px]">{label}</span>
      <div className="flex items-center gap-1.5">
        <img src={recipe[0]} alt="" className="h-[18px] w-[18px] rounded border border-base" />
        <span className="text-faint text-xs leading-none">+</span>
        <img src={recipe[1]} alt="" className="h-[18px] w-[18px] rounded border border-base" />
      </div>
    </div>
  )
}
