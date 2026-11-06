import { App, Modal, Notice, Setting } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { Account, accountTitle, routingLooksValid, last4 } from './check/model'
import { nextCheckNumber } from './register'
import { accountName } from './store'

// Add or edit a bank account (same fields as the desktop app).
export class AccountModal extends Modal {
  private a: Account
  private isNew: boolean
  private routingWarnEl!: HTMLElement
  private thenEl!: HTMLElement

  constructor (app: App, private plugin: PrintMeChecksPlugin, account: Account, private onSaved?: (a: Account) => void) {
    super(app)
    this.a = { ...account }
    this.isNew = !plugin.accounts.accounts.some(x => x.id === account.id)
  }

  onOpen () {
    this.titleEl.setText(this.isNew ? 'New account' : 'Edit account')
    this.modalEl.addClass('pmc-modal')
    const c = this.contentEl
    const a = this.a

    new Setting(c).setName('Nickname').setDesc('Shown in the account list and the register, e.g. Business checking.')
      .addText(t => t.setPlaceholder(accountTitle({ ...a, label: '' })).setValue(a.label).onChange(v => (a.label = v)))

    // Link to an account already in the register (keeps check numbering and
    // register filters continuous with checks saved from the desktop app)
    const regAccounts = this.plugin.store.accounts().filter(r => r.accountId)
    if (regAccounts.length) {
      new Setting(c).setName('Register account')
        .setDesc('If this account already has checks in the register (e.g. from the desktop app), pick it so numbering continues.')
        .addDropdown(d => {
          d.addOption('', '(none)')
          for (const r of regAccounts) d.addOption(r.accountId, `${accountName(r)} (last #${r.lastNumber})`)
          const linked = regAccounts.find(r => r.accountId === a.id)
          d.setValue(linked ? linked.accountId : '')
          d.onChange(v => {
            if (!v) return
            const r = regAccounts.find(x => x.accountId === v)
            if (!r) return
            if (this.plugin.accounts.accounts.some(x => x.id === v && x.id !== this.a.id)) {
              new Notice('Another saved account is already linked to that register account.')
              return
            }
            a.id = v
            if (!a.label) a.label = r.label
            if (!a.bankName) a.bankName = r.bankName
            a.nextCheckNumber = nextCheckNumber(r.lastNumber)
            this.contentEl.empty()
            this.onOpen()
          })
        })
    }

    c.createEl('h6', { text: 'Printed in the top-left corner', cls: 'pmc-sect' })
    this.text(c, 'Account holder name', a.holderName, v => (a.holderName = v))
    this.text(c, 'Street address', a.address, v => (a.address = v))
    this.text(c, 'City', a.city, v => (a.city = v))
    this.text(c, 'State', a.state, v => (a.state = v))
    this.text(c, 'ZIP', a.zip, v => (a.zip = v))

    c.createEl('h6', { text: 'Bank', cls: 'pmc-sect' })
    this.text(c, 'Bank name', a.bankName, v => (a.bankName = v))
    const routing = this.text(c, 'Routing number', a.routingNumber, v => { a.routingNumber = v.trim(); this.checkRouting() }, true)
    routing.inputEl.maxLength = 9
    this.routingWarnEl = c.createDiv('pmc-warn')
    this.text(c, 'Account number', a.accountNumber, v => (a.accountNumber = v.trim()), true)

    c.createEl('h6', { text: 'Check numbers', cls: 'pmc-sect' })
    const num = new Setting(c).setName('Next check number')
      .setDesc('Any format works, e.g. 100 or 100-0001. The last group of digits counts up and keeps its zeros.')
    num.addText(t => t.setValue(a.nextCheckNumber).onChange(v => { a.nextCheckNumber = v.trim(); this.showThen() }))
    this.thenEl = c.createDiv('pmc-then')
    this.showThen()
    this.checkRouting()

    const foot = new Setting(c)
    foot.infoEl.createSpan({ cls: 'pmc-muted', text: this.plugin.settings.accountStorage === 'vault'
      ? 'Saved in the vault (syncs to your other devices).'
      : 'Saved on this device only (not in the vault).' })
    foot.addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
    foot.addButton(b => b.setButtonText(this.isNew ? 'Add account' : 'Save').setCta().onClick(() => this.save()))
  }

  private text (c: HTMLElement, name: string, value: string, onChange: (v: string) => void, mono = false) {
    let comp!: { inputEl: HTMLInputElement }
    new Setting(c).setName(name).addText(t => {
      t.setValue(value || '').onChange(onChange)
      if (mono) t.inputEl.addClass('pmc-mono')
      comp = t
    })
    return comp
  }

  private checkRouting () {
    const r = this.a.routingNumber
    let msg = ''
    if (r && !/^\d{9}$/.test(r)) msg = 'Routing numbers are 9 digits.'
    else if (r && !routingLooksValid(r)) msg = 'This doesn\'t pass the routing number checksum. Double-check it.'
    this.routingWarnEl.setText(msg)
    this.routingWarnEl.toggle(!!msg)
  }

  private showThen () {
    const n = this.a.nextCheckNumber
    if (!n) { this.thenEl.setText(''); return }
    const x = nextCheckNumber(n)
    this.thenEl.setText(`Then: ${x}, ${nextCheckNumber(x)}, …`)
  }

  private async save () {
    const a = this.a
    if (!a.holderName.trim()) return new Notice('Enter the account holder name.')
    if (!a.routingNumber || !a.accountNumber) return new Notice('Enter the routing and account numbers.')
    if (a.routingNumber && !routingLooksValid(a.routingNumber) &&
      !window.confirm('The routing number doesn\'t pass the checksum. Save anyway?')) return
    if (a.accountNumber && !/^[0-9-]+$/.test(a.accountNumber)) return new Notice('Account number: digits only (dashes allowed).')
    await this.plugin.accounts.upsert(a)
    new Notice(`Saved ${accountTitle(a)} (${last4(a.accountNumber)}).`)
    this.onSaved?.(a)
    this.close()
  }
}
