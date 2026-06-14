export type Lang = 'ja' | 'en'

/** name/nameJa を持つオブジェクトから、言語に応じた表示名を返す（ja が空なら en にフォールバック）。 */
export function pickName(lang: Lang, o: { name: string; nameJa?: string }): string {
  if (lang === 'ja') return o.nameJa || o.name
  return o.name
}

/** UI 固定文言（基準）。{x} 等のプレースホルダは t() の vars で置換。 */
const ja = {
  loading: '読み込み中…',
  loadFailed: '読み込みに失敗しました',
  retry: '再試行',
  title: 'TFT 紋章構成アナライザー',
  matchesCount: '{n} マッチ',
  generated: '生成 {time}',
  langSwitchTitle: '表示言語を切替',
  level: 'レベル',
  all: '全体',
  sort: '並び替え',
  sortPlace: '平均順位',
  sortTop4: 'Top4率',
  sortWin: '1位率',
  sortRate: '採用率',
  frequency: '頻度',
  adoptionRate: '採用率',
  metricRate: '採用',
  noCompsRate: '条件に一致する構成がありません（採用率 {x}% 以上）',
  emblems: '紋章',
  selectEmblemHint: '紋章を選択すると、その紋章を使う構成が表示されます',
  selectEmblemHintLeft: '左の紋章を選択すると、その紋章を使う構成が表示されます',
  clear: 'クリア',
  avg: '平均',
  metricTop4: 'Top4',
  metricWin: '1位',
  tierTitle: '平均順位 {x}',
  tierNoData: '平均順位データなし',
  copyCode: '構成コードをコピー',
  copied: 'コピーしました',
  copyCodeTitle: 'チームプランナーに貼り付けるコードをコピー',
  activeTraits: '発動特性 {n}',
  utilization: '活用 {n}/{k}',
  utilizationTitle: '選択した紋章のうち、この構成が活用している数',
}

/** 翻訳キー（ja を基準に型化。en はこの全キーを持つことを型で強制）。 */
export type UIKey = keyof typeof ja

const en: Record<UIKey, string> = {
  loading: 'Loading…',
  loadFailed: 'Failed to load',
  retry: 'Retry',
  title: 'TFT Emblem Comp Analyzer',
  matchesCount: '{n} matches',
  generated: 'Generated {time}',
  langSwitchTitle: 'Switch language',
  level: 'Level',
  all: 'All',
  sort: 'Sort',
  sortPlace: 'Avg Place',
  sortTop4: 'Top4%',
  sortWin: 'Win%',
  sortRate: 'Adoption',
  frequency: 'Frequency',
  adoptionRate: 'Adoption',
  metricRate: 'Use',
  noCompsRate: 'No comps match (adoption ≥ {x}%)',
  emblems: 'Emblems',
  selectEmblemHint: 'Select an emblem to see comps that use it',
  selectEmblemHintLeft: 'Select an emblem on the left to see comps that use it',
  clear: 'Clear',
  avg: 'Avg',
  metricTop4: 'Top4',
  metricWin: 'Win',
  tierTitle: 'Avg place {x}',
  tierNoData: 'No avg place data',
  copyCode: 'Copy team code',
  copied: 'Copied',
  copyCodeTitle: 'Copy code for Team Planner',
  activeTraits: '{n} traits',
  utilization: 'Uses {n}/{k}',
  utilizationTitle: 'How many of the selected emblems this comp uses',
}

const STRINGS: Record<Lang, Record<UIKey, string>> = { ja, en }

/** UI 文言を取得。`{key}` プレースホルダを vars で置換。未定義言語は ja にフォールバック。 */
export function t(lang: Lang, key: UIKey, vars?: Record<string, string | number>): string {
  let s = STRINGS[lang][key] ?? ja[key]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  }
  return s
}
