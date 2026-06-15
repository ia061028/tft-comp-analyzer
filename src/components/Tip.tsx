import type { ReactNode } from 'react'

interface TipProps {
  label: string
  children: ReactNode
  className?: string
}

/** ホバー/フォーカスで label を吹き出し表示する軽量ツールチップ（CSSのみ・依存なし）。 */
export function Tip({ label, children, className }: TipProps) {
  return (
    <span className={`group/tip relative inline-flex ${className ?? ''}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-950 px-2 py-1 text-xs font-medium text-zinc-100 opacity-0 shadow-lg ring-1 ring-zinc-700 transition-opacity duration-100 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}
