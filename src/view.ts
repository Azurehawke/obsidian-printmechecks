import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { Entry, STATUSES, CheckStatus } from './register'
import { accountKey, accountName } from './store'
import { money, totalOf, newestFirst, statusClass } from './format'
import { ConfirmModal, RecordCheckModal } from './modals'

export const VIEW_TYPE = 'printmechecks-register'

export class RegisterView extends ItemView {
  private search = ''
  private account = ''
  private status = ''
  private body!: HTMLElement

  constructor (leaf: WorkspaceLeaf, private plugin: PrintMeChecksPlugin) {
    super(leaf)
  }

  getViewType () { return VIEW_TYPE }
  getDisplayText () { return 'Check register' }
  getIcon () { return 'landmark' }

  async onOpen () {
    this.contentEl.addClass('pmc-view')
    this.registerEvent(this.plugin.store.on('changed', () => this.render()))
    this.render()
    if (!this.plugin.store.loaded) await this.plugin.store.reload()
  }

  private render () {
    const store = this.plugin.store
    const el = this.contentEl
    el.empty()

    // Header
    const head = el.createDiv('pmc-head')
    const title = head.createDiv('pmc-title')
    title.createEl('h3', { text: 'Check register' })
    if (store.file) title.createSpan({ cls: 'pmc-file', text: store.file.path })
    const actions = head.createDiv('pmc-actions')
    this.button(actions, 'plus', 'Record check', () => new RecordCheckModal(this.app, this.plugin).open(), true)
    this.button(actions, 'refresh-cw', 'Reload', () => store.reload())
    if (store.file) this.button(actions, 'table', 'Open file', () => this.app.workspace.getLeaf('tab').openFile(store.file!))

    if (store.error) {
      const err = el.createDiv('pmc-error')
      err.setText(store.error)
      if (!store.path || !store.file) {
        const b = err.createEl('button', { text: 'Open settings' })
        b.onclick = () => this.plugin.openSettings()
      }
      return
    }

    // Filters
    const filters = el.createDiv('pmc-filters')
    const search = filters.createEl('input', { type: 'search', placeholder: 'Search payee, memo, check #…', value: this.search })
    search.oninput = () => { this.search = search.value; this.renderRows() }
    const acct = filters.createEl('select')
    acct.createEl('option', { value: '', text: 'All accounts' })
    for (const a of store.accounts()) acct.createEl('option', { value: a.key, text: accountName(a) })
    acct.value = this.account
    acct.onchange = () => { this.account = acct.value; this.renderRows() }
    const stat = filters.createEl('select')
    stat.createEl('option', { value: '', text: 'Any status' })
    for (const s of STATUSES) stat.createEl('option', { value: s, text: s })
    stat.value = this.status
    stat.onchange = () => { this.status = stat.value; this.renderRows() }

    this.body = el.createDiv('pmc-body')
    this.renderRows()
  }

  private rows (): Entry[] {
    const needle = this.search.trim().toLowerCase()
    return this.plugin.store.entries
      .filter(e => !this.account || accountKey(e) === this.account)
      .filter(e => !this.status || (e.status || 'Issued') === this.status)
      .filter(e => !needle || [e.payTo, e.memo, e.checkNumber, e.date, e.amount].some(v => (v || '').toLowerCase().includes(needle)))
      .sort(newestFirst)
  }

  private renderRows () {
    const body = this.body
    body.empty()
    const rows = this.rows()
    const sum = body.createDiv('pmc-summary')
    const outstanding = rows.filter(e => (e.status || 'Issued') === 'Issued')
    sum.createSpan({ text: `${rows.length} check${rows.length === 1 ? '' : 's'} · ${money(totalOf(rows))}` })
    if (outstanding.length && this.status !== 'Issued') {
      sum.createSpan({ cls: 'pmc-muted', text: ` · ${outstanding.length} outstanding (${money(totalOf(outstanding))})` })
    }

    if (!rows.length) {
      body.createDiv({ cls: 'pmc-empty', text: this.plugin.store.entries.length ? 'No checks match.' : 'No checks in the register yet.' })
      return
    }

    const wrap = body.createDiv('pmc-table-wrap')
    const table = wrap.createEl('table', { cls: 'pmc-table' })
    const tr = table.createEl('thead').createEl('tr')
    for (const h of ['Date', 'Check #', 'Payee', 'Amount', 'Memo', 'Status', 'Account', '']) {
      tr.createEl('th', { text: h, cls: h === 'Amount' ? 'pmc-num' : '' })
    }
    const tbody = table.createEl('tbody')
    for (const e of rows) {
      const row = tbody.createEl('tr', { cls: e.status === 'Void' ? 'pmc-void' : '' })
      row.createEl('td', { text: e.date })
      row.createEl('td', { text: e.checkNumber, cls: 'pmc-mono' })
      row.createEl('td', { text: e.payTo, cls: 'pmc-payee' })
      row.createEl('td', { text: money(e.amount), cls: 'pmc-num pmc-mono pmc-amt' })
      row.createEl('td', { text: e.memo, cls: 'pmc-memo' })
      const sel = row.createEl('td').createEl('select', { cls: statusClass(e.status) })
      for (const s of STATUSES) sel.createEl('option', { value: s, text: s })
      sel.value = e.status || 'Issued'
      sel.onchange = async () => {
        try {
          await this.plugin.store.setStatus(e.id, sel.value as CheckStatus)
        } catch (err) {
          new Notice('Could not update the register: ' + (err as Error).message)
          this.renderRows()
        }
      }
      row.createEl('td', { text: accountName(e), cls: 'pmc-muted' })
      const del = row.createEl('td').createEl('button', { cls: 'clickable-icon pmc-del', attr: { 'aria-label': 'Delete' } })
      setIcon(del, 'trash-2')
      del.onclick = () => new ConfirmModal(this.app,
        `Delete check #${e.checkNumber} to ${e.payTo || '(no payee)'}?`,
        'This removes the row from the register file. To keep a record, set its status to Void instead.',
        'Delete',
        async () => {
          try { await this.plugin.store.remove(e.id) } catch (err) { new Notice('Could not delete: ' + (err as Error).message) }
        }).open()
    }
  }

  private button (parent: HTMLElement, icon: string, label: string, onClick: () => void, cta = false) {
    const b = parent.createEl('button', { cls: cta ? 'mod-cta' : '' })
    setIcon(b.createSpan('pmc-btn-icon'), icon)
    b.createSpan({ text: label })
    b.onclick = onClick
    return b
  }
}
