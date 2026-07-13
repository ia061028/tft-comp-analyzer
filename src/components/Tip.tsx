import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TipProps {
  label: ReactNode
  children: ReactNode
  className?: string
}

/** 吹き出しとアンカーの間隔。 */
const GAP = 6
/** 画面端からの最小マージン。 */
const EDGE = 8

/**
 * ホバー/キーボードフォーカスで label を吹き出し表示する軽量ツールチップ。
 *
 * **吹き出しは body へのポータルに `position: fixed` で描く。**
 * 以前は通常フローの `absolute` だったため、祖先のクリップ領域に切られていた —
 * `<main>` と `<aside>` の `overflow-y-auto`（スクロール用）、カードの `overflow-hidden` など。
 * 個別に潰しても新しいスクロール領域を足すたびに再発するので、切られない場所へ逃がす。
 *
 * 表示条件が `:focus-within` ではなく `:focus-visible` なのは、紋章タイルを**クリック**した後も
 * ボタンにフォーカスが残り、吹き出しが開きっぱなしで隣のタイルを覆ってしまうため。
 * 「紋章を替えて見比べる」のが最頻タスクなので、次に押したいタイルが消えるのは致命的だった。
 */
export function Tip({ label, children, className }: TipProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // 未計測のうちは null。計測前に描くと (0,0) に一瞬出てしまうので、その間は透明にする。
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(
    null,
  )

  const place = useCallback(() => {
    const a = anchor.current
    const b = bubble.current
    if (!a || !b) return
    const ar = a.getBoundingClientRect()
    const br = b.getBoundingClientRect()

    // 上に入らなければ下へ回す（画面上端のカードでも切られない）。
    const below = ar.top - br.height - GAP < EDGE
    const top = below ? ar.bottom + GAP : ar.top - br.height - GAP

    // 左右は画面内に収める。矢印はアンカーの中心を指したままにする。
    const centerX = ar.left + ar.width / 2
    const left = Math.min(
      Math.max(centerX - br.width / 2, EDGE),
      Math.max(EDGE, window.innerWidth - br.width - EDGE),
    )
    setPos({ left, top, arrow: centerX - left, below })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    // 開いている間にスクロール/リサイズが起きたら追従する（fixed なので自動では動かない）。
    const on = () => place()
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
    }
  }, [open, place, label])

  const show = () => setOpen(true)
  const hide = () => {
    setOpen(false)
    setPos(null)
  }

  return (
    <span
      ref={anchor}
      className={`relative inline-flex ${className ?? ''}`}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={(e) => {
        // クリック後のフォーカス残りでは出さない。キーボード操作のときだけ出す。
        if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) show()
      }}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              opacity: pos ? 1 : 0,
            }}
            className="pointer-events-none fixed z-[100] whitespace-nowrap rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-ink shadow-xl ring-1 ring-line-strong transition-opacity duration-100"
          >
            {label}
            <div
              style={{ left: pos?.arrow ?? 0 }}
              className={`absolute h-2 w-2 -translate-x-1/2 rotate-45 bg-surface-2 ring-1 ring-line-strong ${
                pos?.below ? '-top-1' : '-bottom-1'
              }`}
            />
          </div>,
          document.body,
        )}
    </span>
  )
}
