interface SegmentedControlProps<T extends string> {
  /** 選択肢（キーと表示ラベル）。 */
  options: readonly { key: T; label: string }[]
  value: T
  onChange: (key: T) => void
  /** アクセシビリティ用のグループ名。 */
  ariaLabel?: string
}

/** セグメント型の単一選択コントロール（ユニット数・並び替えで共用）。 */
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
      className="inline-flex overflow-hidden rounded-md border border-line bg-surface-2 p-0.5"
    >
      {options.map(({ key, label }) => {
        const active = value === key
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={`rounded px-3 py-1 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
              active
                ? 'bg-gold text-base shadow-sm'
                : 'text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
