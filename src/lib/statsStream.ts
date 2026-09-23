import type { WireComp, WireStatsFile } from '../../shared/types'

/**
 * stats*.json を届いた順に読む。
 *
 * 集計側（collector の serializeStatsFile）は、中身は普通の JSON のまま行の置き方だけ決めて書く:
 *
 *   1行目        comps 以外の全キー。末尾は `"comps":[`
 *   2行目〜      構成を1行に1つ（最後以外は末尾に `,`）
 *   最終行       `]}`
 *
 * 1行目が届いた時点で辞書（紋章・ユニット等）が揃うので、構成を待たずに画面を出せる。
 * この形でないファイル（schemaVersion 7 以前は1行の JSON）は、最後まで溜めてから丸ごと読む。
 */
export class StatsStreamParser {
  private buf = ''
  private mode: 'unknown' | 'stream' | 'whole' = 'unknown'
  private headFile: WireStatsFile | null = null
  private comps: WireComp[] = []
  private ended = false

  /** 1行目を読めていれば、comps が空の状態のファイル。 */
  get head(): WireStatsFile | null {
    return this.headFile
  }

  /** ここまでに読めた構成の数。 */
  get received(): number {
    return this.comps.length
  }

  push(chunk: string): void {
    const from = this.buf.length
    this.buf += chunk
    if (this.mode === 'whole') return
    if (this.mode === 'unknown') {
      // 1行目の終わりは今回の塊の中だけ探す（1行の旧ファイルで全体を毎回なめ直さない）。
      const nl = this.buf.indexOf('\n', from)
      if (nl === -1) return
      const line = this.buf.slice(0, nl)
      if (!line.endsWith('"comps":[')) {
        // 想定した行の置き方ではない。溜めたまま最後に丸ごと読む。
        this.mode = 'whole'
        return
      }
      this.headFile = JSON.parse(`${line}]}`) as WireStatsFile
      this.mode = 'stream'
      this.buf = this.buf.slice(nl + 1)
    }
    let start = 0
    let nl: number
    const batch: string[] = []
    while ((nl = this.buf.indexOf('\n', start)) !== -1) {
      this.takeLine(this.buf.slice(start, nl), batch)
      start = nl + 1
    }
    this.buf = this.buf.slice(start)
    this.flush(batch)
  }

  /** 読み終わり。途中で切れたファイルは throw する。 */
  finish(): WireStatsFile {
    if (this.mode !== 'stream') return JSON.parse(this.buf) as WireStatsFile
    const batch: string[] = []
    if (this.buf !== '') this.takeLine(this.buf, batch)
    this.buf = ''
    this.flush(batch)
    if (!this.ended) throw new Error('stats file ended early')
    return { ...this.headFile!, comps: this.comps }
  }

  private takeLine(line: string, batch: string[]): void {
    if (this.ended) {
      if (line.trim() !== '') throw new Error('unexpected data after stats file end')
      return
    }
    if (line === ']}') {
      this.ended = true
      return
    }
    batch.push(line.endsWith(',') ? line.slice(0, -1) : line)
  }

  // 1行ずつ JSON.parse するより、届いた塊ごとに配列として1回で読む方が速い。
  private flush(batch: string[]): void {
    if (batch.length === 0) return
    const parsed = JSON.parse(`[${batch.join(',')}]`) as WireComp[]
    for (const c of parsed) this.comps.push(c)
  }
}
