export type Lang = 'ja' | 'en'

/** name/nameJa を持つオブジェクトから、言語に応じた表示名を返す（ja が空なら en にフォールバック）。 */
export function pickName(lang: Lang, o: { name: string; nameJa?: string }): string {
  if (lang === 'ja') return o.nameJa || o.name
  return o.name
}

/** UI 固定文言。{x} 等のプレースホルダは t() の vars で置換。 */
const STRINGS: Record<Lang, Record<string, string>> = {
  ja: {
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
    sortPick: 'Pick率',
    sortRate: '採用率',
    frequency: '頻度',
    adoptionRate: '採用率',
    metricRate: '採用',
    noCompsRate: '条件に一致する構成がありません（採用率 {x}% 以上）',
    emblemSelectedFreq: '紋章選択中: 頻度 {x}',
    emblems: '紋章',
    selectEmblemHint: '紋章を選択すると、その紋章を使う構成が表示されます',
    selectEmblemHintLeft: '左の紋章を選択すると、その紋章を使う構成が表示されます',
    noComps: '条件に一致する構成がありません（頻度 {x} 以上）',
    clear: 'クリア',
    avg: '平均',
    metricTop4: 'Top4',
    metricWin: '1位',
    metricPick: 'Pick',
    tierTitle: '平均順位 {x}',
    tierNoData: '平均順位データなし',
    copyCode: '構成コードをコピー',
    copied: 'コピーしました',
    copyCodeTitle: 'チームプランナーに貼り付けるコードをコピー',
    activeTraits: '発動特性 {n}',
  },
  en: {
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
    sortPick: 'Pick%',
    sortRate: 'Adoption',
    frequency: 'Frequency',
    adoptionRate: 'Adoption',
    metricRate: 'Use',
    noCompsRate: 'No comps match (adoption ≥ {x}%)',
    emblemSelectedFreq: 'Emblem selected: freq {x}',
    emblems: 'Emblems',
    selectEmblemHint: 'Select an emblem to see comps that use it',
    selectEmblemHintLeft: 'Select an emblem on the left to see comps that use it',
    noComps: 'No comps match (frequency ≥ {x})',
    clear: 'Clear',
    avg: 'Avg',
    metricTop4: 'Top4',
    metricWin: 'Win',
    metricPick: 'Pick',
    tierTitle: 'Avg place {x}',
    tierNoData: 'No avg place data',
    copyCode: 'Copy team code',
    copied: 'Copied',
    copyCodeTitle: 'Copy code for Team Planner',
    activeTraits: '{n} traits',
  },
}

/** UI 文言を取得。`{key}` プレースホルダを vars で置換。未定義キーは ja にフォールバック。 */
export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = STRINGS[lang][key] ?? STRINGS.ja[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  }
  return s
}
