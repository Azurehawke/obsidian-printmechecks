import { Events, EventRef, Notice, Platform, Plugin, TAbstractFile, TFile, normalizePath } from 'obsidian'
import { DEFAULT_SETTINGS, Settings, SettingsTab } from './settings'
import { RegisterStore, accountKey } from './store'
import { RegisterView, VIEW_TYPE } from './view'
import { CheckEditorView, EDITOR_VIEW } from './editor'
import { RecordCheckModal } from './modals'
import { PrintPreviewModal } from './previewModal'
import { registerChecksBlock } from './codeblock'
import { AccountStore, parseExport } from './accounts'
import { Account, CheckData, DEFAULT_LAYOUT, accountTitle, last4 } from './check/model'
import { Entry, compareCheckNumbers, nextCheckNumber, todayString } from './register'
import { canPrint, chooseSavePath, writeFile } from './check/print'

export default class PrintMeChecksPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS }
  store!: RegisterStore
  accounts!: AccountStore
  check: CheckData = { checkNumber: '', date: todayString(), payTo: '', amount: '0.00', memo: '' }
  private events = new Events()

  async onload () {
    await this.loadSettings()
    this.store = new RegisterStore(this.app, () => this.settings.registerPath)
    this.accounts = new AccountStore(this)
    this.accounts.load()

    this.registerView(VIEW_TYPE, leaf => new RegisterView(leaf, this))
    this.registerView(EDITOR_VIEW, leaf => new CheckEditorView(leaf, this))
    registerChecksBlock(this)
    this.addSettingTab(new SettingsTab(this.app, this))

    this.addRibbonIcon('file-pen-line', 'Write a check', () => this.openEditor())
    this.addRibbonIcon('landmark', 'Open check register', () => this.openRegister())
    this.addCommand({ id: 'write-check', name: 'Write a check', callback: () => this.openEditor() })
    this.addCommand({ id: 'open-register', name: 'Open check register', callback: () => this.openRegister() })
    this.addCommand({ id: 'record-check', name: 'Record a check (without printing)', callback: () => new RecordCheckModal(this.app, this).open() })
    this.addCommand({ id: 'reload-register', name: 'Reload check register', callback: () => this.store.reload() })
    this.addCommand({
      id: 'print-check',
      name: 'Print check (preview)',
      checkCallback: (checking) => {
        if (!canPrint() || !this.accounts.active) return false
        if (!checking) new PrintPreviewModal(this.app, this).open()
        return true
      }
    })
    this.addCommand({ id: 'save-check-to-register', name: 'Save current check to register', callback: () => this.saveCheckToRegister() })
    this.addCommand({ id: 'import-accounts', name: 'Import accounts from the desktop app', callback: () => this.importAccountsFromFile() })

    // Keep in step with the register file: edits from the desktop app, Excel, sync…
    const isRegister = (f: TAbstractFile) => f instanceof TFile && f.path === this.store.path
    this.registerEvent(this.app.vault.on('modify', f => { if (isRegister(f)) this.store.scheduleReload() }))
    this.registerEvent(this.app.vault.on('create', f => { if (isRegister(f)) this.store.scheduleReload() }))
    this.registerEvent(this.app.vault.on('delete', f => { if (isRegister(f)) this.store.scheduleReload() }))
    this.registerEvent(this.app.vault.on('rename', async (f, oldPath) => {
      if (normalizePath(oldPath) === this.store.path) {
        this.settings.registerPath = f.path
        await this.saveSettings()
        this.store.scheduleReload()
      }
    }))

    this.app.workspace.onLayoutReady(async () => {
      await this.store.reload()
      if (!this.check.checkNumber) this.setCheck({ checkNumber: this.suggestNumber(this.accounts.active) })
    })
  }

  // ---------- Current check ----------

  // silent: update without re-rendering open editors (used while typing)
  setCheck (patch: Partial<CheckData>, silent = false) {
    Object.assign(this.check, patch)
    if (!silent) this.events.trigger('check')
  }

  onCheckChanged (cb: () => void): EventRef {
    return this.events.on('check', cb)
  }

  // The account's next number, or the register's next number for it (if
  // checks were saved elsewhere since), whichever comes later.
  suggestNumber (a: Account | null) {
    if (!a) return ''
    const own = a.nextCheckNumber || '100'
    const fromRegister = this.store.nextNumberFor(a.id)
    if (!fromRegister) return own
    const cmp = compareCheckNumbers(fromRegister, own)
    return cmp !== null && cmp > 0 ? fromRegister : own
  }

  // A check number already in the register for this account (any status,
  // including Void). Matched by account id, or by last four digits for entries
  // saved without one.
  findExisting (a: Account, checkNumber: string) {
    const n = checkNumber.trim()
    if (!n) return undefined
    return this.store.entries.find(e => e.checkNumber.trim() === n &&
      (e.accountId ? e.accountId === a.id : e.accountLast4 === last4(a.accountNumber)))
  }

  // Typing an existing check number pulls up that check instead of starting a
  // duplicate. Called when the field loses focus with a changed number.
  lookupCheckNumber (previous: string) {
    const n = this.check.checkNumber.trim()
    const a = this.accounts.active
    if (!n || !a || n === previous.trim()) return
    const e = this.findExisting(a, n)
    if (!e) return
    this.setCheck({ checkNumber: e.checkNumber, date: e.date, payTo: e.payTo, amount: e.amount, memo: e.memo })
    new Notice(`Check #${n} is already in the register (${e.status || 'Issued'}). Loaded it. To correct it, void it in the register and make a new check.`)
  }

  async saveCheckToRegister () {
    const a = this.accounts.active
    if (!a) return new Notice('Add a bank account first.')
    if (!this.store.file) {
      new Notice('Set the register file first (Settings → Print Me Checks).')
      return this.openSettings()
    }
    const c = this.check
    if (this.findExisting(a, c.checkNumber)) {
      return new Notice(`Check #${c.checkNumber} is already in the register for this account, so it was not saved again. Void it in the register, or change the check number.`)
    }
    try {
      await this.store.add({
        date: c.date,
        checkNumber: c.checkNumber,
        payTo: c.payTo,
        amount: c.amount,
        memo: c.memo,
        status: 'Issued',
        accountLabel: accountTitle(a),
        bankName: a.bankName,
        accountLast4: last4(a.accountNumber),
        accountId: a.id
      })
    } catch (e) {
      return new Notice('Could not save to the register: ' + (e as Error).message)
    }
    // Advance the account's next number (unless this was an older check)
    const following = nextCheckNumber(c.checkNumber)
    const cmp = compareCheckNumbers(a.nextCheckNumber, following)
    if (cmp === null || cmp < 0) {
      a.nextCheckNumber = following
      await this.accounts.upsert(a)
    }
    new Notice(`Check #${c.checkNumber} saved to the register. Next check number: ${a.nextCheckNumber}.`)
    this.settings.lastAccountKey = a.id
    await this.saveSettings()
  }

  // Load a register entry into the editor (Register → Open)
  openCheckFromEntry (e: Entry) {
    const accts = this.accounts.accounts
    const a = accts.find(x => x.id === e.accountId) ||
      accts.find(x => e.accountLast4 && last4(x.accountNumber) === e.accountLast4 && (!e.bankName || x.bankName === e.bankName))
    if (a) this.accounts.setActive(a.id)
    else new Notice(`No saved account matches ${e.accountLabel || 'that check'}; it's shown on the current account.`)
    this.setCheck({ checkNumber: e.checkNumber, date: e.date, payTo: e.payTo, amount: e.amount, memo: e.memo })
    this.openEditor()
  }

  // ---------- Import / export (shared format with the desktop app) ----------

  importAccountsFromFile () {
    const input = createEl('input', { type: 'file', attr: { accept: '.json,application/json' } })
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const data = parseExport(await f.text())
        const { added, updated } = await this.accounts.importAccounts(data.accounts)
        let msg = `Imported accounts: ${added} added, ${updated} updated.`
        if (data.layout) {
          this.settings.layout = { ...DEFAULT_LAYOUT, ...this.settings.layout, ...data.layout, zoom: this.settings.layout.zoom }
          await this.saveSettings()
          msg += ' Font and alignment settings imported too.'
        }
        if (!this.check.checkNumber) this.setCheck({ checkNumber: this.suggestNumber(this.accounts.active) })
        this.events.trigger('check')
        new Notice(msg)
      } catch (e) {
        new Notice('Import failed: ' + (e as Error).message)
      }
    }
    input.click()
  }

  async exportAccountsToFile () {
    if (!Platform.isDesktopApp) return new Notice('Export needs Obsidian on a computer.')
    const p = await chooseSavePath('Print Me Checks accounts.json')
    if (!p) return
    const json = JSON.stringify(this.accounts.exportData(this.settings.layout), null, 2)
    writeFile(p, new TextEncoder().encode(json))
    new Notice(`Exported ${this.accounts.accounts.length} account(s). The file contains full account numbers; keep it safe.`)
  }

  // ---------- Views / settings ----------

  async openRegister () {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
    const leaf = existing ?? this.app.workspace.getLeaf('tab')
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true })
    this.app.workspace.revealLeaf(leaf)
    this.app.workspace.setActiveLeaf(leaf, { focus: true })
  }

  async openEditor () {
    const existing = this.app.workspace.getLeavesOfType(EDITOR_VIEW)[0]
    const leaf = existing ?? this.app.workspace.getLeaf('tab')
    if (!existing) await leaf.setViewState({ type: EDITOR_VIEW, active: true })
    this.app.workspace.revealLeaf(leaf)
    this.app.workspace.setActiveLeaf(leaf, { focus: true })
  }

  openSettings () {
    const setting = (this.app as unknown as { setting: { open: () => void, openTabById: (id: string) => void } }).setting
    setting.open()
    setting.openTabById(this.manifest.id)
  }

  async loadSettings () {
    const data = (await this.loadData()) || {}
    this.settings = { ...DEFAULT_SETTINGS, ...data, layout: { ...DEFAULT_LAYOUT, ...(data.layout || {}) } }
  }

  async saveSettings () {
    await this.saveData(this.settings)
  }

  // Used by older register rows
  accountKeyOf (e: Entry) { return accountKey(e) }
}
