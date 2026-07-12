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
  boardSize: 'ユニット数',
  all: '全体',
  sort: '並び替え',
  sortHint: 'サンプル数を考慮して並べます（採用数の少ない極端な率は上位に来にくくなります）。表示している数字は生の値です。',
  sortPlace: '平均順位',
  sortTop4: 'Top4率',
  sortWin: '1位率',
  sortAdopt: '採用数',
  frequency: '頻度',
  adoptionRate: '採用数下限',
  metricRate: '採用',
  noCompsRate: '条件に一致する構成がありません（採用率 {x}% 以上）',
  noCompsAdopt: '該当する構成がありません（採用数 {x} 以上）',
  emblems: '紋章',
  selectEmblemHint: '紋章を選択すると、その紋章を使う構成が表示されます',
  selectEmblemHintLeft: '左の紋章を選択すると、その紋章を使う構成が表示されます',
  clear: 'クリア',
  removeHint: 'クリックで解除',
  avg: '平均',
  metricTop4: 'Top4',
  metricWin: '1位',
  tierTitle: '平均順位 {x}',
  tierNoData: '平均順位データなし',
  copyCode: '構成コードをコピー',
  copied: 'コピーしました',
  copyCodeTitle: 'チームプランナーに貼り付けるコードをコピー',
  activeTraits: '発動特性 {n}',
  resultCount: '{n} 構成',
  utilization: '活用 {n}/{k}',
  utilizationTitle: '選択した紋章のうち、この構成が活用している数',
  bronzeMode: '生涯ブロンズ',
  bronzeModeTitle: 'ブロンズ特性（固有特性を除く、最小ティアで発動中の特性）が多い順に構成を表示',
  bronzeBadge: 'ブロンズ {n}',
  strictMode: '選択紋章のみ',
  strictModeTitle:
    '選択した紋章だけで達成した試合に限定（他の紋章を併用した試合、および同一紋章を選択枚数より多く使った試合を除外）',
  extraEmblems: '他紋章 {p}%',
  extraEmblemsTitle: 'この行の試合のうち、選択していない紋章も活用していた割合',
  overCapWarn: 'この紋章を同時に {n} 枚活用した構成はデータにありません（データ上の最大は {max} 枚）。クリックで1枚減らします。',
  emblemCatSpatula: 'へら',
  emblemCatPan: 'フライパン',
  emblemCatNone: '合成不可',
  emblemOpHint: 'クリックで+1 / Shift+クリック・右クリックで-1',
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
  boardSize: 'Units',
  all: 'All',
  sort: 'Sort',
  sortHint: 'Ranked with sample size taken into account (extreme rates from few games are pushed down). The numbers shown are the raw values.',
  sortPlace: 'Avg Place',
  sortTop4: 'Top4%',
  sortWin: 'Win%',
  sortAdopt: 'Adoption',
  frequency: 'Frequency',
  adoptionRate: 'Min adoption',
  metricRate: 'Use',
  noCompsRate: 'No comps match (adoption ≥ {x}%)',
  noCompsAdopt: 'No comps match (adoption ≥ {x})',
  emblems: 'Emblems',
  selectEmblemHint: 'Select an emblem to see comps that use it',
  selectEmblemHintLeft: 'Select an emblem on the left to see comps that use it',
  clear: 'Clear',
  removeHint: 'Click to remove',
  avg: 'Avg',
  metricTop4: 'Top4',
  metricWin: 'Win',
  tierTitle: 'Avg place {x}',
  tierNoData: 'No avg place data',
  copyCode: 'Copy team code',
  copied: 'Copied',
  copyCodeTitle: 'Copy code for Team Planner',
  activeTraits: '{n} traits',
  resultCount: '{n} comps',
  utilization: 'Uses {n}/{k}',
  utilizationTitle: 'How many of the selected emblems this comp uses',
  bronzeMode: 'Lifelong Bronze',
  bronzeModeTitle: 'Rank comps by number of bronze traits (non-unique traits active at their lowest tier)',
  bronzeBadge: 'Bronze {n}',
  strictMode: 'Selected only',
  strictModeTitle:
    'Limit to games achieved with the selected emblems alone (exclude games that also used other emblems, or more copies of an emblem than selected)',
  extraEmblems: 'Other {p}%',
  extraEmblemsTitle: 'Share of this row’s games that also used emblems you did not select',
  overCapWarn: 'No comp in the data used {n} copies of this emblem at once (max is {max}). Click to remove one.',
  emblemCatSpatula: 'Spatula',
  emblemCatPan: 'Frying Pan',
  emblemCatNone: 'Non-craftable',
  emblemOpHint: 'Click to add / Shift+click or right-click to remove',
}

const STRINGS: Record<Lang, Record<UIKey, string>> = { ja, en }

/**
 * 文字列内の `{key}` プレースホルダを vars で置換する。同一プレースホルダが複数回出現しても
 * 全て置換する（String#replace は初出のみのため replaceAll 相当に実装）。vars 未指定はそのまま返す。
 */
export function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  let out = s
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

/** UI 文言を取得。`{key}` プレースホルダを vars で置換。未定義言語は ja にフォールバック。 */
export function t(lang: Lang, key: UIKey, vars?: Record<string, string | number>): string {
  return interpolate(STRINGS[lang][key] ?? ja[key], vars)
}
