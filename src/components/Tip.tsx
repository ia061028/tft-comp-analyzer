import type { ReactNode } from 'react'

interface TipProps {
  label: ReactNode
  children: ReactNode
  className?: string
}

/** ホバー/フォーカスで label を吹き出し表示する軽量ツールチップ（CSSのみ・依存なし）。 */
export function Tip({ label, children, className }: TipProps) {
  return (
    <span className={`group/tip relative inline-flex ${className ?? ''}`}>
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-zinc-100 opacity-0 shadow-lg ring-1 ring-zinc-700 transition-all duration-100 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-focus-within/tip:translate-y-0 group-focus-within/tip:opacity-100"
      >
        {label}
        <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-zinc-950 ring-1 ring-zinc-700" />
      </div>
    </span>
  )
}
