import type { ReactNode } from 'react'

interface TipProps {
  label: ReactNode
  children: ReactNode
  className?: string
}

/**
 * ホバー/キーボードフォーカスで label を吹き出し表示する軽量ツールチップ（CSSのみ・依存なし）。
 *
 * 表示条件が :focus-within ではなく :focus-visible なのは、紋章タイルを**クリック**した後も
 * ボタンにフォーカスが残り、吹き出しが開きっぱなしで隣のタイルを覆ってしまうため。
 * 「紋章を替えて見比べる」のが最頻タスクなので、次に押したいタイルが消えるのは致命的だった。
 * :focus-visible ならキーボード操作時だけ出るので、アクセシビリティは落とさずに解決できる。
 */
export function Tip({ label, children, className }: TipProps) {
  return (
    <span className={`group/tip relative inline-flex ${className ?? ''}`}>
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-ink opacity-0 shadow-xl ring-1 ring-line-strong transition-all duration-100 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:translate-y-0 group-has-[:focus-visible]/tip:opacity-100"
      >
        {label}
        <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-surface-2 ring-1 ring-line-strong" />
      </div>
    </span>
  )
}
