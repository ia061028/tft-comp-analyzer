interface SegmentedControlProps<T extends string> {
  /** 選択肢（キーと表示ラベル）。 */
  options: readonly { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
  /** アクセシビリティ用のグループ名。 */
  ariaLabel?: string
}

/** セグメント型の単一選択コントロール（レベル・並び替えで共用）。 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/50 p-0.5 shadow-inner"
    >
      {options.map(({ key, label }) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
              active
                ? 'bg-amber-400 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
