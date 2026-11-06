// Bank accounts used to print checks (full account and routing numbers).
//
// Where they're kept is a setting:
//   'device' (default): Obsidian's local storage on this device only. Never
//                       written into the vault, so never synced.
//   'vault':            the plugin's data.json in the vault, so they sync to
//                       your other devices along with the vault.
import { Events } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { Account, LayoutSettings, blankAccount } from './check/model'
import { newId } from './register'

const KEY_ACCOUNTS = 'printmechecks-accounts'
const KEY_ACTIVE = 'printmechecks-active-account'

export type AccountStorage = 'device' | 'vault'

// File format shared with the desktop app (Accounts → Export / Import)
export interface AccountsExport {
  app: 'printmechecks'
  version: 1
  exportedAt: string
  accounts: Account[]
  layout?: Partial<LayoutSettings>
}

export class AccountStore extends Events {
  accounts: Account[] = []
  activeId = ''

  constructor (private plugin: PrintMeChecksPlugin) {
    super()
  }

  private get app () { return this.plugin.app }

  load () {
    const s = this.plugin.settings
    const list = s.accountStorage === 'vault'
      ? s.vaultAccounts
      : (this.app.loadLocalStorage(KEY_ACCOUNTS) as Account[] | null)
    this.accounts = Array.isArray(list) ? list.map(a => ({ ...blankAccount(a.id || newId()), ...a })) : []
    const active = this.app.loadLocalStorage(KEY_ACTIVE) as string | null
    this.activeId = active && this.accounts.some(a => a.id === active) ? active : (this.accounts[0]?.id || '')
    this.trigger('changed')
  }

  async persist () {
    const s = this.plugin.settings
    if (s.accountStorage === 'vault') {
      s.vaultAccounts = this.accounts
      await this.plugin.saveSettings()
    } else {
      this.app.saveLocalStorage(KEY_ACCOUNTS, this.accounts)
    }
    this.app.saveLocalStorage(KEY_ACTIVE, this.activeId)
    this.trigger('changed')
  }

  get active (): Account | null {
    return this.accounts.find(a => a.id === this.activeId) || this.accounts[0] || null
  }

  async setActive (id: string) {
    this.activeId = id
    await this.persist()
  }

  async upsert (a: Account) {
    const i = this.accounts.findIndex(x => x.id === a.id)
    if (i >= 0) this.accounts[i] = { ...a }
    else this.accounts.push({ ...a })
    if (i < 0 || !this.activeId) this.activeId = a.id
    await this.persist()
  }

  async remove (id: string) {
    this.accounts = this.accounts.filter(a => a.id !== id)
    if (this.activeId === id) this.activeId = this.accounts[0]?.id || ''
    await this.persist()
  }

  // Move accounts between this device and the vault
  async setStorage (mode: AccountStorage) {
    const s = this.plugin.settings
    if (s.accountStorage === mode) return
    const current = this.accounts
    s.accountStorage = mode
    if (mode === 'vault') {
      s.vaultAccounts = current
      this.app.saveLocalStorage(KEY_ACCOUNTS, null)
    } else {
      this.app.saveLocalStorage(KEY_ACCOUNTS, current)
      s.vaultAccounts = []
    }
    await this.plugin.saveSettings()
    this.load()
  }

  // Merge accounts from an export file. Same id (or same routing + account
  // number) replaces; anything else is added. Returns counts.
  async importAccounts (list: Account[]) {
    let added = 0
    let updated = 0
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const a: Account = { ...blankAccount(raw.id || newId()), ...raw }
      const i = this.accounts.findIndex(x => x.id === a.id ||
        (x.routingNumber && x.routingNumber === a.routingNumber && x.accountNumber === a.accountNumber))
      if (i >= 0) {
        // Take the imported id: it's the one the register uses for this account
        this.accounts[i] = { ...a }
        updated++
      } else {
        this.accounts.push(a)
        added++
      }
    }
    if (!this.activeId && this.accounts.length) this.activeId = this.accounts[0].id
    await this.persist()
    return { added, updated }
  }

  exportData (layout?: LayoutSettings): AccountsExport {
    return { app: 'printmechecks', version: 1, exportedAt: new Date().toISOString(), accounts: this.accounts, layout }
  }
}

export function parseExport (text: string): AccountsExport {
  let data: unknown
  try { data = JSON.parse(text) } catch { throw new Error('That file isn\'t valid JSON.') }
  const d = data as Partial<AccountsExport>
  if (!d || d.app !== 'printmechecks' || !Array.isArray(d.accounts)) {
    throw new Error('That isn\'t a Print Me Checks accounts export.')
  }
  return d as AccountsExport
}
