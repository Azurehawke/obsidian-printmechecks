import { App, Modal, Notice, Setting } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { STATUSES, todayString, parseAmount, parseDate, newId } from './register'
import { accountName } from './store'
import { money } from './format'

export class ConfirmModal extends Modal {
  constructor (app: App, private title: string, private message: string, private cta: string, private onYes: () => void) {
    super(app)
  }

  onOpen () {
    this.titleEl.setText(this.title)
    this.contentEl.createEl('p', { text: this.message })
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText(this.cta).setWarning().onClick(() => { this.close(); this.onYes() }))
  }
}

const NEW = '__new'

// Record a check written by hand (or anywhere else) in the register.
export class RecordCheckModal extends Modal {
  private accountKey = ''
  private newAccount = { label: '', bankName: '', last4: '' }
  private checkNumber = ''
  private date = todayString()
  private payTo = ''
  private amount = ''
  private memo = ''
  private status = 'Issued'
  private numberInput?: HTMLInputElement
  private newAcctEl?: HTMLElement

  constructor (app: App, private plugin: PrintMeChecksPlugin) {
    super(app)
  }

  onOpen () {
    const store = this.plugin.store
    if (!store.file) {
      new Notice('Set the register file first (Settings → Print Me Checks).')
      this.close()
      this.plugin.openSettings()
      return
    }
    this.titleEl.setText('Record a check')
    this.modalEl.addClass('pmc-modal')
    const c = this.contentEl
    const accounts = store.accounts()
    const lastUsed = this.plugin.settings.lastAccountKey
    this.accountKey = accounts.some(a => a.key === lastUsed) ? lastUsed : accounts[0]?.key || NEW
    this.checkNumber = this.accountKey === NEW ? '' : store.nextNumberFor(this.accountKey)

    new Setting(c).setName('Account').addDropdown(d => {
      for (const a of accounts) d.addOption(a.key, accountName(a))
      d.addOption(NEW, 'New account…')
      d.setValue(this.accountKey)
      d.onChange(v => {
        this.accountKey = v
        this.newAcctEl?.toggle(v === NEW)
        const next = v === NEW ? '' : store.nextNumberFor(v)
        this.checkNumber = next
        if (this.numberInput) this.numberInput.value = next
      })
    })

    this.newAcctEl = c.createDiv('pmc-new-account')
    new Setting(this.newAcctEl).setName('Account name').setDesc('As it should appear in the register, e.g. Business checking')
      .addText(t => t.onChange(v => (this.newAccount.label = v)))
    new Setting(this.newAcctEl).setName('Bank')
      .addText(t => t.onChange(v => (this.newAccount.bankName = v)))
    new Setting(this.newAcctEl).setName('Last 4 digits of account number')
      .addText(t => { t.inputEl.maxLength = 4; t.inputEl.inputMode = 'numeric'; t.onChange(v => (this.newAccount.last4 = v.replace(/\D/g, ''))) })
    this.newAcctEl.toggle(this.accountKey === NEW)

    new Setting(c).setName('Check #').setDesc('Next in the series is filled in; any format works, e.g. 100-0001.')
      .addText(t => {
        this.numberInput = t.inputEl
        t.setValue(this.checkNumber).onChange(v => (this.checkNumber = v.trim()))
      })
    new Setting(c).setName('Date')
      .addText(t => t.setPlaceholder('M/D/YYYY').setValue(this.date).onChange(v => (this.date = v.trim())))
    new Setting(c).setName('Pay to')
      .addText(t => {
        const listId = 'pmc-payees-' + newId()
        const list = c.createEl('datalist', { attr: { id: listId } })
        for (const p of store.payees()) list.createEl('option', { value: p })
        t.inputEl.setAttr('list', listId)
        t.onChange(v => (this.payTo = v))
        window.setTimeout(() => t.inputEl.focus(), 50)
      })
    new Setting(c).setName('Amount')
      .addText(t => { t.inputEl.inputMode = 'decimal'; t.setPlaceholder('0.00').onChange(v => (this.amount = v)) })
    new Setting(c).setName('Memo')
      .addText(t => t.onChange(v => (this.memo = v)))
    new Setting(c).setName('Status')
      .addDropdown(d => { for (const s of STATUSES) d.addOption(s, s); d.setValue(this.status).onChange(v => (this.status = v)) })

    new Setting(c)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Add to register').setCta().onClick(() => this.submit()))
    this.scope.register(['Mod'], 'Enter', () => { this.submit(); return false })
  }

  private async submit () {
    const store = this.plugin.store
    const amount = parseAmount(this.amount)
    if (!this.payTo.trim()) return new Notice('Enter who the check is paid to.')
    if (amount === null) return new Notice('Enter the amount.')
    if (!this.checkNumber) return new Notice('Enter the check number.')
    if (!parseDate(this.date)) return new Notice('Use a date like 11/6/2026.')
    let acct = { accountId: '', accountLabel: '', bankName: '', accountLast4: '' }
    if (this.accountKey === NEW) {
      if (!this.newAccount.label.trim()) return new Notice('Name the new account.')
      acct = {
        accountId: newId(),
        accountLabel: this.newAccount.label.trim(),
        bankName: this.newAccount.bankName.trim(),
        accountLast4: this.newAccount.last4 ? '••' + this.newAccount.last4 : ''
      }
    } else {
      const a = store.accounts().find(x => x.key === this.accountKey)
      if (a) acct = { accountId: a.accountId, accountLabel: a.label, bankName: a.bankName, accountLast4: a.last4 }
    }
    const dupe = store.entries.find(e => e.checkNumber === this.checkNumber &&
      (e.accountId ? e.accountId === acct.accountId : e.accountLabel === acct.accountLabel))
    if (dupe && !window.confirm(`Check #${this.checkNumber} is already in the register for this account (to ${dupe.payTo}). Add it anyway?`)) return
    try {
      await store.add({
        ...acct,
        checkNumber: this.checkNumber,
        date: this.date,
        payTo: this.payTo.trim(),
        amount: amount.toFixed(2),
        memo: this.memo.trim(),
        status: this.status
      })
      this.plugin.settings.lastAccountKey = acct.accountId || `${acct.accountLabel}|${acct.accountLast4}`
      await this.plugin.saveSettings()
      new Notice(`Check #${this.checkNumber} to ${this.payTo.trim()} for ${money(amount)} added to the register.`)
      this.close()
    } catch (err) {
      new Notice('Could not add to the register: ' + (err as Error).message)
    }
  }
}
