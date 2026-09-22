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
 *
 * **丸で描く**。紋章バッジ（四角・金リング）と同じ形だと、駒が持ち込む特性を
 * 装備した紋章と読み違える。形が違えば凡例なしで別物だと分かる。
 */
export function GrantBadges({ grants, traits, lang, size }: GrantBadgesProps) {
  if (grants.length === 0) return null
  // 最大4個（カ＝ジックスの進化）。横一列だと駒の幅を超えて隣の列のアイテムに被るので、
  // 2個で折り返して駒の左上に 2×2 で積む。**駒の枠から出さない**（出すと隣に被る）。
  // 駒は隠れるが、隠れて困るのは名前だけでアイコンは端が見えていれば分かる。
  const maxWidth = `calc(${typeof size === 'number' ? `${size}px` : size} * 2 + 2px)`
  return (
    <div className="grant-badges" style={{ maxWidth }}>
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
              style={{ height: size, width: size, opacity: applied ? 1 : 0.45 }}
              className="shrink-0 rounded-full bg-base object-contain p-[1px] ring-2 ring-line-strong"
            />
          </Tip>
        )
      })}
    </div>
  )
}
