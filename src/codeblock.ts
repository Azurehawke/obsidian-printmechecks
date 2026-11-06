import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { Entry, parseDate, parseAmount } from './register'
import { accountName } from './store'
import { money, totalOf, newestFirst, statusClass } from './format'

// ```checks
// status: Issued            (one or more, comma separated)
// account: Business         (matches account name, bank, or last 4)
// payee: Edison             (contains)
// from: 1/1/2026            (check date on/after)
// to: 12/31/2026            (check date on/before)
// limit: 10
// sort: date | number | amount | payee   (add "asc" for oldest/smallest first)
// columns: date, number, payee, amount, memo, status, account
// total: true               (show the total row; default true)
// ```

const ALL_COLUMNS = ['date', 'number', 'payee', 'amount', 'memo', 'status', 'account'] as const
type Col = typeof ALL_COLUMNS[number]
const HEADERS: Record<Col, string> = {
  date: 'Date', number: 'Check #', payee: 'Payee', amount: 'Amount', memo: 'Memo', status: 'Status', account: 'Account'
}

interface Options {
  status: string[]
  account: string
  payee: string
  from: Date | null
  to: Date | null
  limit: number
  sort: string
  asc: boolean
  columns: Col[]
  total: boolean
  errors: string[]
}

export function parseOptions (src: string): Options {
  const o: Options = {
    status: [], account: '', payee: '', from: null, to: null, limit: 0,
    sort: 'date', asc: false, columns: ['date', 'number', 'payee', 'amount', 'status'], total: true, errors: []
  }
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf(':')
    if (i < 0) { o.errors.push(`Not understood: "${line}"`); continue }
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    switch (key) {
      case 'status': o.status = val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean); break
      case 'account': o.account = val.toLowerCase(); break
      case 'payee': o.payee = val.toLowerCase(); break
      case 'from': o.from = parseDate(val); if (!o.from) o.errors.push(`Bad date: ${val}`); break
      case 'to': o.to = parseDate(val); if (!o.to) o.errors.push(`Bad date: ${val}`); break
      case 'limit': o.limit = Math.max(0, parseInt(val) || 0); break
      case 'sort': {
        const [field, dir] = val.toLowerCase().split(/\s+/)
        o.sort = field || 'date'
        o.asc = dir === 'asc'
        break
      }
      case 'columns': {
        const cols = val.toLowerCase().split(',').map(s => s.trim().replace(/^check ?#?$/, 'number')) as Col[]
        const bad = cols.filter(c => !ALL_COLUMNS.includes(c))
        if (bad.length) o.errors.push(`Unknown column(s): ${bad.join(', ')}`)
        o.columns = cols.filter(c => ALL_COLUMNS.includes(c))
        break
      }
      case 'total': o.total = !/^(false|no|off|0)$/i.test(val); break
      default: o.errors.push(`Unknown option: ${key}`)
    }
  }
  return o
}

export function filterEntries (entries: Entry[], o: Options) {
  let rows = entries.filter(e => {
    if (o.status.length && !o.status.includes((e.status || 'Issued').toLowerCase())) return false
    if (o.account && ![e.accountLabel, e.bankName, e.accountLast4].some(v => (v || '').toLowerCase().includes(o.account))) return false
    if (o.payee && !(e.payTo || '').toLowerCase().includes(o.payee)) return false
    const d = parseDate(e.date)
    if (o.from && (!d || d < o.from)) return false
    if (o.to && (!d || d > o.to)) return false
    return true
  })
  const cmp: Record<string, (a: Entry, b: Entry) => number> = {
    date: (a, b) => -newestFirst(a, b),
    number: (a, b) => a.checkNumber.localeCompare(b.checkNumber, undefined, { numeric: true }),
    amount: (a, b) => (parseAmount(a.amount) ?? 0) - (parseAmount(b.amount) ?? 0),
    payee: (a, b) => a.payTo.localeCompare(b.payTo)
  }
  const f = cmp[o.sort] || cmp.date
  rows = rows.sort((a, b) => (o.asc ? f(a, b) : -f(a, b)))
  if (o.limit) rows = rows.slice(0, o.limit)
  return rows
}

class ChecksBlock extends MarkdownRenderChild {
  constructor (el: HTMLElement, private plugin: PrintMeChecksPlugin, private src: string) {
    super(el)
  }

  onload () {
    this.registerEvent(this.plugin.store.on('changed', () => this.render()))
    this.render()
    if (!this.plugin.store.loaded) this.plugin.store.reload()
  }

  render () {
    const el = this.containerEl
    el.empty()
    el.addClass('pmc-embed')
    const store = this.plugin.store
    const o = parseOptions(this.src)
    if (o.errors.length) el.createDiv({ cls: 'pmc-error', text: o.errors.join(' · ') })
    if (!store.loaded) { el.createDiv({ cls: 'pmc-muted', text: 'Loading check register…' }); return }
    if (store.error) { el.createDiv({ cls: 'pmc-error', text: store.error }); return }

    const rows = filterEntries(store.entries, o)
    if (!rows.length) { el.createDiv({ cls: 'pmc-muted', text: 'No checks match.' }); return }

    const table = el.createEl('table', { cls: 'pmc-table' })
    const hr = table.createEl('thead').createEl('tr')
    for (const c of o.columns) hr.createEl('th', { text: HEADERS[c], cls: c === 'amount' ? 'pmc-num' : '' })
    const tb = table.createEl('tbody')
    for (const e of rows) {
      const tr = tb.createEl('tr', { cls: e.status === 'Void' ? 'pmc-void' : '' })
      for (const c of o.columns) {
        switch (c) {
          case 'date': tr.createEl('td', { text: e.date }); break
          case 'number': tr.createEl('td', { text: e.checkNumber, cls: 'pmc-mono' }); break
          case 'payee': tr.createEl('td', { text: e.payTo, cls: 'pmc-payee' }); break
          case 'amount': tr.createEl('td', { text: money(e.amount), cls: 'pmc-num pmc-mono pmc-amt' }); break
          case 'memo': tr.createEl('td', { text: e.memo }); break
          case 'status': tr.createEl('td').createSpan({ text: e.status || 'Issued', cls: 'pmc-pill ' + statusClass(e.status) }); break
          case 'account': tr.createEl('td', { text: accountName(e) }); break
        }
      }
    }
    if (o.total && o.columns.includes('amount')) {
      const tr = table.createEl('tfoot').createEl('tr')
      for (const c of o.columns) {
        if (c === 'amount') tr.createEl('td', { text: money(totalOf(rows)), cls: 'pmc-num pmc-mono' })
        else if (c === o.columns[0]) tr.createEl('td', { text: `Total (${rows.length})` })
        else tr.createEl('td')
      }
    }
  }
}

export function registerChecksBlock (plugin: PrintMeChecksPlugin) {
  plugin.registerMarkdownCodeBlockProcessor('checks', (src: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    ctx.addChild(new ChecksBlock(el, plugin, src))
  })
}
