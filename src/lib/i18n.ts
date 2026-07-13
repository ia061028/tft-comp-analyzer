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
  sortHint: '選んだ指標だけで並べます。ただしサンプル数を考慮するため、採用数の少ない極端な率は上位に来にくくなります（表示している数字は生の値）。',
  fullUseOnly: '{n}枚すべて使う',
  fullUseOnlyTitle: '選択した紋章を1枚残らず活用している構成だけに絞る。OFF なら一部だけ使う構成も出るので、どの紋章がより良い盤面につながるか見比べられる',
  noCompsFullUse: '採用数 {x} 以上で、選択した {n} 枚をすべて使う構成がありません。',
  noCompsFullUseAction: '一部だけ使う構成も表示する',
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
  selectEmblemHint: '紋章を選択すると、その紋章だけで組める構成が表示されます',
  selectEmblemHintLeft: '左の紋章を選択すると、その紋章だけで組める構成が表示されます',
  clear: 'クリア',
  removeHint: 'クリックで解除',
  avg: '平均',
  avgPlace: '平均順位',
  metricTop4: 'Top4率',
  metricWin: '1位率',
  metricSample: '採用数',
  lowSample: '少',
  lowSampleTitle: '採用 {n} 件未満。率が大きくブレるので鵜呑みにしない',
  tierTitle: '平均順位 {x}',
  tierNoData: '平均順位データなし',
  copyCode: 'コード コピー',
  copied: 'コピー済み',
  copyCodeTitle: 'チームプランナーに貼り付けるコードをコピー',
  activeTraits: '発動特性 {n}',
  resultCount: '{n} 構成',
  backbone: 'コア · 共通 {n} 体',
  unitsGroup: '{n} 体',
  compareWithin: 'この中だけで比較',
  derivCount: '{n} 件',
  derivBackboneOnly: 'コアのみ（追加なし）',
  missing: '抜く',
  otherComps: 'その他 {n} 構成',
  statRange: '{min}〜{max}',
  statMedian: '中央 {x}',
  synergyGain: '伸びる特性',
  utilization: '活用 {n}/{k}',
  utilizationLabel: '活用紋章',
  utilizationTitle: '選択した紋章のうち、この構成が活用している数',
  bronzeMode: '生涯ブロンズ',
  bronzeModeTitle: 'ブロンズ特性（固有特性を除く、最小ティアで発動中の特性）が多い順に構成を表示',
  bronzeBadge: 'ブロンズ {n}',
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
  sortHint: 'Ranked purely by the metric you pick, but with sample size taken into account (extreme rates from few games are pushed down). The numbers shown are the raw values.',
  fullUseOnly: 'Use all {n}',
  fullUseOnlyTitle: 'Show only comps that use every selected emblem. Turn it off to also see comps that use just some of them — that is how you compare which emblem leads to a better board',
  noCompsFullUse: 'No comp with at least {x} games uses all {n} selected emblems.',
  noCompsFullUseAction: 'Also show comps that use only some',
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
  selectEmblemHint: 'Select an emblem to see comps buildable with just that emblem',
  selectEmblemHintLeft: 'Select an emblem on the left to see comps buildable with just it',
  clear: 'Clear',
  removeHint: 'Click to remove',
  avg: 'Avg',
  avgPlace: 'Avg Place',
  metricTop4: 'Top4%',
  metricWin: 'Win%',
  metricSample: 'Games',
  lowSample: 'few',
  lowSampleTitle: 'Fewer than {n} games. The rates swing wildly — do not trust them',
  tierTitle: 'Avg place {x}',
  tierNoData: 'No avg place data',
  copyCode: 'Copy code',
  copied: 'Copied',
  copyCodeTitle: 'Copy code for Team Planner',
  activeTraits: '{n} traits',
  resultCount: '{n} comps',
  backbone: 'Core · {n} shared',
  unitsGroup: '{n} units',
  compareWithin: 'compare within this group only',
  derivCount: '{n}',
  derivBackboneOnly: 'Core only (nothing added)',
  missing: 'drop',
  otherComps: '{n} other comps',
  statRange: '{min}–{max}',
  statMedian: 'med {x}',
  synergyGain: 'Traits gained',
  utilization: 'Uses {n}/{k}',
  utilizationLabel: 'Emblems used',
  utilizationTitle: 'How many of the selected emblems this comp uses',
  bronzeMode: 'Lifelong Bronze',
  bronzeModeTitle: 'Rank comps by number of bronze traits (non-unique traits active at their lowest tier)',
  bronzeBadge: 'Bronze {n}',
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
