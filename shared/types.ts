// 収集側（collector/）とフロントエンド（src/）の両方から参照される型定義

/** data/state/records/{route}.ndjson の1行 ＝ 参加者1人分の収集レコード */
export interface ParticipantRecord {
  /** マッチID（例: "SG2_88412345"） */
  m: string
  /** パッチ（例: "16.11"） */
  v: string
  /** 順位 1-8 */
  p: number
  /** 発動トレイト（tier_current>=1）→ style（1=ブロンズ,2=シルバー,3=ゴールド,4=プリズム） */
  t: Record<string, number>
  /** 発動トレイト → ユニット数(num_units)。例: ブローラー2なら2（旧レコードは欠落） */
  tc?: Record<string, number>
  /** 装備された紋章アイテムの apiName（重複保持・発動フィルタは集計時に適用） */
  e: string[]
  /** e と同インデックスで対応する装備ユニットの character_id（旧レコードは欠落） */
  eh?: string[]
  /** 盤面ユニットの character_id */
  u: string[]
  /** u と同インデックスで対応する、そのユニットの完成アイテム apiName 群（旧レコードは欠落） */
  ui?: string[][]
  /** u と同インデックスで対応する、そのユニットのスターレベル(1-3)（旧レコードは欠落） */
  us?: number[]
  /** プレイヤーレベル */
  lv: number
  /** game_datetime（epoch秒） */
  ts: number
}

export interface TraitInfo {
  api: string
  name: string
  /** 日本語表示名 */
  nameJa: string
  icon: string
  /** 発動ティア [minUnits, style]（昇順）。発動数・配色の算出に使う。 */
  tiers: [number, number][]
}

export interface EmblemInfo {
  api: string
  name: string
  /** 日本語表示名 */
  nameJa: string
  /** traits 配列へのインデックス */
  trait: number
  icon: string
  /** 合成素材分類: none=合成不可, spatula=へら系, fryingpan=フライパン系 */
  base: 'none' | 'spatula' | 'fryingpan'
}

export interface UnitInfo {
  api: string
  name: string
  /** 日本語表示名 */
  nameJa: string
  cost: number
  icon: string
  /** チームプランナーのチャンピオンバイト値（ロスター内 apiName 昇順の1始まり位置。非ロスターは0） */
  code: number
  /** このユニットが所持するトレイト（traits 配列インデックス）。発動数の算出に使う。 */
  traits: number[]
}

export interface ItemInfo {
  api: string
  name: string
  /** 日本語表示名 */
  nameJa: string
  icon: string
}

/**
 * 紋章活用シグネチャ: 1つ以上の紋章を「発動」させたレコード群を、
 * 発動効率でグループ化したもの。
 * - one: そのレコードで +1（装備・発動・発動数に余りなし＝ちょうどブレークポイント）の emblem idx 集合。
 * - half: +0.5（装備・発動・発動数に余りあり）の emblem idx 集合。
 * - n/top4/win: 該当レコード数・Top4数・1位数。
 */
export interface EmblemSig {
  one: number[]
  half: number[]
  n: number
  top4: number
  win: number
  /** 順位合計。平均順位 = p / n。 */
  p: number
}

/**
 * 構成 = 盤面ユニット集合が完全一致するレコード群（召喚除外）。
 * 紋章活用は sigs から、選択紋章に応じてランタイムで算出する。
 */
export interface CompStats {
  /** 盤面ユニット（units 配列インデックス、コスト順）。構成キー兼表示。 */
  units: number[]
  /** この盤面の総レコード数。 */
  n: number
  /** units と同順の代表スターレベル(1-3、不明は0)。 */
  unitStars: number[]
  /** キャリー中心の推奨完成アイテム [unitIdx, itemIdx, count]。 */
  unitItems: [number, number, number][]
  /** 各紋章を最も多く装備したユニット [emblemIdx, unitIdx, count]（発動ゲート済み）。 */
  holders: [number, number, number][]
  /** 紋章活用シグネチャ群。 */
  sigs: EmblemSig[]
}

/** オンディスク圧縮形式の構成（stats.json）。data.ts の decodeStats で CompStats へ復元。 */
export interface WireComp {
  /** units */
  u: number[]
  n: number
  /** unitStars（全0なら省略） */
  k?: number[]
  /** unitItems（空なら省略） */
  i?: [number, number, number][]
  /** holders（空なら省略） */
  h?: [number, number, number][]
  /** sigs: [one[], half[], n, top4, win, p] */
  g: [number[], number[], number, number, number, number][]
}

/** stats.json 全体のオンディスク圧縮形式。 */
export interface WireStatsFile {
  schemaVersion: 3
  generatedAt: string
  patch: string
  tftPatch: string
  setNumber: number
  totals: {
    matches: number
    participants: number
    byRoute: Record<string, number>
  }
  traits: TraitInfo[]
  emblems: EmblemInfo[]
  units: UnitInfo[]
  items: ItemInfo[]
  comps: WireComp[]
  baseItemIcons?: { spatula: string; fryingPan: string }
}

/** public/data/stats.json をデコードしたフロント内部の表現。 */
export interface StatsFile {
  schemaVersion: number
  generatedAt: string
  /** 内部パッチキー（game_version 由来、例 "16.12"） */
  patch: string
  /** 表示用 TFT バージョン（例 "17.5"。未マップ時は patch にフォールバック） */
  tftPatch: string
  setNumber: number
  totals: {
    matches: number
    participants: number
    byRoute: Record<string, number>
  }
  traits: TraitInfo[]
  emblems: EmblemInfo[]
  units: UnitInfo[]
  items: ItemInfo[]
  comps: CompStats[]
  /** 合成素材アイコン（紋章グリッドのカテゴリヘッダ用） */
  baseItemIcons?: { spatula: string; fryingPan: string }
}
