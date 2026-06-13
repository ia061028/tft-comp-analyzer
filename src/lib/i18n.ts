export type Lang = 'ja' | 'en'

/** name/nameJa を持つオブジェクトから、言語に応じた表示名を返す（ja が空なら en にフォールバック）。 */
export function pickName(lang: Lang, o: { name: string; nameJa?: string }): string {
  if (lang === 'ja') return o.nameJa || o.name
  return o.name
}
