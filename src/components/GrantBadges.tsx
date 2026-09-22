import type { TraitGrant, TraitInfo } from '../../shared/types'
import { pickName, type Lang } from '../lib/i18n'
import { GRANT_APPLY_SHARE } from '../lib/format'
import { Tip } from './Tip'

interface GrantBadgesProps {
  /** このユニットが上乗せする特性（share 降順）。 */
  grants: TraitGrant[]
  traits: TraitInfo[]
  lang: Lang
  /** バッジ1つの辺の長さ。数値は px、文字列は CSS の長さ（`var(--lane-badge)` など）。 */
  size: number | string
}

/**
 * ユニットアイコンの左上に「このユニットが持ち込む特性」を出す。
 *
 * 静的データに出ない上乗せ（ラックスの選択特性・カ＝ジックスの進化・
 * エルダードラゴンのリフトビースト2体分）は、盤面を見ただけでは絶対に分からない。
 * 特性チップの数だけ合っていても「どの駒のおかげか」が読めないと構成を再現できないので、
 * 付与元のアイコンに直接付ける。
 *
 * 選択制の機構は構成の中でも選択が割れるので、過半に満たない選択は薄く描く。
 * 数字や凡例は出さない（割合は吹き出しに入れる）。盤面は一瞬で読む場所なので、
 * 「確実な選択か、割れている選択か」は濃さだけで伝える。
 */
export function GrantBadges({ grants, traits, lang, size }: GrantBadgesProps) {
  if (grants.length === 0) return null
  // 最大4個（カ＝ジックスの進化）を横一列に並べると駒の幅を超えて隣の列に被るので、
  // 2個で折り返して駒の左上に 2×2 で積む。3個以上は駒そのものが隠れない寸法まで縮める。
  const scale = grants.length > 2 ? 0.62 : 1
  const side = typeof size === 'number' ? `${size * scale}px` : `calc(${size} * ${scale})`
  const maxWidth = `calc(${side} * 2 + 2px)`
  return (
    <div
      className="absolute -left-1.5 -top-1.5 z-10 flex flex-wrap gap-0.5"
      style={{ maxWidth }}
    >
      {grants.map((g) => {
        const trait = traits[g.trait]
        if (!trait) return null
        const name = pickName(lang, trait)
        const applied = g.share >= GRANT_APPLY_SHARE
        return (
          <Tip
            key={g.trait}
            label={`${name} +${g.delta} · ${Math.round(g.share * 100)}%`}
          >
            <img
              src={trait.icon}
              alt=""
              loading="lazy"
              style={{ height: side, width: side, opacity: applied ? 1 : 0.45 }}
              className="shrink-0 rounded-md bg-base object-contain p-[1px] ring-2 ring-line-strong"
            />
          </Tip>
        )
      })}
    </div>
  )
}
