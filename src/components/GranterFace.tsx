import type { UnitInfo } from '../../shared/types'
import { GRANT_APPLY_SHARE, type GrantSource } from '../lib/format'
import { pickName, type Lang } from '../lib/i18n'

interface GranterFaceProps {
  /** この特性を伸ばした駒と上乗せ。無ければ何も描かない。 */
  source: GrantSource | undefined
  units: UnitInfo[]
  lang: Lang
}

/**
 * 発動特性チップの先頭に「この数を伸ばした駒」の顔を出す。
 *
 * 静的データに出ない上乗せ（ラックスの選択特性・カ＝ジックスの進化・
 * エルダードラゴンのリフトビースト2体分）は盤面を見ただけでは分からない。
 * 駒のアイコンにバッジで付けていたが、カ＝ジックスは4つ付くので 48px の駒が
 * バッジで埋まって読めなかった。上乗せは結局「その特性が何体分か」の話なので、
 * 数が出ているチップ側に置く。チップの高さは変えない（折り返した行の背がガタつく）。
 *
 * 選択制の機構は構成の中でも選択が割れるので、過半に満たない選択は薄く描く。
 */
export function GranterFace({ source, units, lang }: GranterFaceProps) {
  if (!source) return null
  const unit = units[source.unit]
  if (!unit) return null
  return (
    <img
      src={unit.icon}
      alt={pickName(lang, unit)}
      loading="lazy"
      style={{ opacity: source.grant.share >= GRANT_APPLY_SHARE ? 1 : 0.45 }}
      className="-ml-1 h-4 w-4 shrink-0 rounded-full object-cover ring-1 ring-ink/40"
    />
  )
}
