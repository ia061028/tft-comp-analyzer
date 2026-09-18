import { sampleLevel, SAMPLE_TONE } from '../lib/format'
import { t, type Lang } from '../lib/i18n'
import { Tip } from './Tip'

/** 段階 → 説明文のキー（sampleLevel の 0..3 と同順）。 */
const BAND_KEYS = ['sampleBand0', 'sampleBand1', 'sampleBand2', 'sampleBand3'] as const

interface SampleMeterProps {
  /** この行の採用数（＝この盤面をこの紋章の使い方で組んだ試合数）。 */
  n: number
  lang: Lang
  /** 'lg' は構成カードの統計行、'sm' は派生行。数字の大きさだけが変わる。 */
  size?: 'sm' | 'lg'
  /** 採用数で並べ替え中なら金でハイライトする（他の統計セルと同じ規則）。 */
  active?: boolean
}

/**
 * 採用数を「数字 ＋ 4段階の目盛り」で出す。
 *
 * 以前は採用数下限フィルタで薄い行を一覧から消していたが、それだと紋章を2枚以上使う構成が
 * ほぼ全部消えていた（実データで2枚使う行の 76% が採用数1）。消す代わりに、どれだけの試合に
 * 裏付けられた行なのかをここで常に見せる。数字だけだと 1 と 40 の差を読み飛ばすので、
 * 一目で段が分かる目盛りを添える。
 */
export function SampleMeter({ n, lang, size = 'sm', active = false }: SampleMeterProps) {
  const level = sampleLevel(n)
  const tone = SAMPLE_TONE[level]

  return (
    <Tip label={`${t(lang, 'sampleTitle', { n })} — ${t(lang, BAND_KEYS[level])}`}>
      <span className="inline-flex cursor-help items-center gap-1.5">
        <b
          className={`font-bold leading-tight tabular-nums ${active ? 'text-gold' : tone.text} ${
            size === 'lg' ? 'text-[17px]' : ''
          }`}
        >
          {n}
        </b>
        <span className="flex items-center gap-[2px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-[4px] w-[5px] rounded-[1px] ${i <= level ? tone.fill : 'bg-line-strong'}`}
            />
          ))}
        </span>
      </span>
    </Tip>
  )
}
