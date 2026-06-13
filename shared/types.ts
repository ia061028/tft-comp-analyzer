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
}

export interface EmblemInfo {
  api: string
  name: string
  /** 日本語表示名 */
  nameJa: string
  /** traits 配列へのインデックス */
  trait: number
  icon: string
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
}

export interface ItemInfo {
  api: string
  name: string
  /** 日本語表示名 */
  nameJa: string
  icon: string
}

/** 構成クラスタ内の紋章マルチセットごとの成績 */
export interface EmblemRow {
  /** emblems 配列インデックスのソート済みマルチセット（空=紋章なし） */
  e: number[]
  n: number
  top4: number
  win: number
  /** この行の順位(placement)合計。平均順位 = p / n */
  p: number
}

export interface CompStats {
  /** クラスタキー: [traitIdx, 最頻style] のソート済みペア（スタイル上位 clusterMaxKeyTraits 件、label構築用） */
  traits: [number, number][]
  /**
   * この構成で代表的に発動しているシナジー [traitIdx, 最頻style, 代表ユニット数]。
   * クラスタ内の過半数(>=50%)で発動(tier>=1=ブロンズ以上)しているトレイト。style降順。
   * 代表ユニット数は最頻 num_units（旧データは 0）。
   */
  synergies: [number, number, number][]
  label: string
  /** 日本語の構成名（traits の日本語名で構築） */
  labelJa: string
  /** クラスタ内最頻ユニット（units 配列インデックス、コスト順） */
  units: number[]
  /** units と同インデックスで対応する代表スターレベル(1-3、不明は0)。us ありレコードから集計。 */
  unitStars: number[]
  n: number
  top4: number
  win: number
  rows: EmblemRow[]
  /**
   * この構成で各紋章を最も多く装備したユニット。
   * [emblemIdx, unitIdx, count]。holder が分かるレコード（eh あり）からのみ集計。
   */
  holders: [number, number, number][]
  /**
   * キャリー中心の上位ユニットの推奨完成アイテム。
   * [unitIdx, itemIdx, count]。ui が分かるレコードからのみ集計。
   */
  unitItems: [number, number, number][]
}

/** public/data/stats.json 全体 */
export interface StatsFile {
  schemaVersion: 1
  generatedAt: string
  /** 内部パッチキー（game_version 由来、例 "16.12"） */
  patch: string
  /** 表示用 TFT バージョン（例 "17.5"。未マップ時は patch にフォールバック） */
  tftPatch: string
  setNumber: number
  config: { minStyle: number; minSampleDefault: number; emblemMinSample: number }
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
  /** レベル別の構成（キー "7".."10"）。全体は comps。 */
  compsByLevel: Record<string, CompStats[]>
}
