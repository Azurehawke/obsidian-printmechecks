import { App, Events, TFile, normalizePath } from 'obsidian'
import {
  Entry, CheckStatus, readEntries, appendEntry, setEntryStatus, removeEntry, createRegister,
  nextCheckNumber, compareCheckNumbers, newId
} from './register'

// An account as seen in the register (the file never has full numbers)
export interface RegisterAccount {
  key: string
  accountId: string
  label: string
  bankName: string
  last4: string
  lastNumber: string // highest/latest check number used
}

export function accountKey (e: Pick<Entry, 'accountId' | 'accountLabel' | 'accountLast4'>) {
  return e.accountId || `${e.accountLabel}|${e.accountLast4}`
}

export function accountName (a: { label?: string, accountLabel?: string, bankName?: string, last4?: string, accountLast4?: string }) {
  return a.label || a.accountLabel || [a.bankName, a.last4 || a.accountLast4].filter(Boolean).join(' ') || '(no account)'
}

// Loads the register .xlsx from the vault, keeps it in memory, and writes
// changes back. Fires 'changed' whenever entries change.
export class RegisterStore extends Events {
  entries: Entry[] = []
  error = ''
  loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private reloadTimer: number | undefined

  constructor (private app: App, private getPath: () => string) {
    super()
  }

  get path () {
    const p = this.getPath()
    return p ? normalizePath(p) : ''
  }

  get file (): TFile | null {
    if (!this.path) return null
    const f = this.app.vault.getAbstractFileByPath(this.path)
    return f instanceof TFile ? f : null
  }

  private changed () {
    this.trigger('changed')
  }

  async reload () {
    const f = this.file
    if (!this.path) {
      this.entries = []
      this.error = 'No register file is set. Choose one in Settings → Print Me Checks.'
    } else if (!f) {
      this.entries = []
      this.error = `Register file not found: ${this.path}`
    } else {
      try {
        this.entries = await readEntries(await this.app.vault.readBinary(f))
        this.error = ''
      } catch (e) {
        this.error = `Couldn't read ${f.name}: ${(e as Error).message}`
      }
    }
    this.loaded = true
    this.changed()
  }

  // Debounced reload, for file-change events (sync tools may write in bursts)
  scheduleReload () {
    window.clearTimeout(this.reloadTimer)
    this.reloadTimer = window.setTimeout(() => this.reload(), 400)
  }

  // Serialized read-modify-write so two quick edits never overwrite each other
  private mutate (fn: (data: ArrayBuffer) => Promise<ArrayBuffer>) {
    const run = async () => {
      const f = this.file
      if (!f) throw new Error(this.path ? `Register file not found: ${this.path}` : 'No register file is set.')
      const out = await fn(await this.app.vault.readBinary(f))
      await this.app.vault.modifyBinary(f, out)
      this.entries = await readEntries(out)
      this.error = ''
      this.changed()
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  add (e: Partial<Entry>) {
    const entry = { status: 'Issued', savedAt: new Date().toISOString(), ...e, id: e.id || newId() }
    return this.mutate(d => appendEntry(d, entry))
  }

  setStatus (id: string, status: CheckStatus) {
    return this.mutate(d => setEntryStatus(d, id, status))
  }

  remove (id: string) {
    return this.mutate(d => removeEntry(d, id))
  }

  async createFile (path: string) {
    const p = normalizePath(path.endsWith('.xlsx') ? path : path + '.xlsx')
    if (this.app.vault.getAbstractFileByPath(p)) throw new Error(`${p} already exists.`)
    const dir = p.split('/').slice(0, -1).join('/')
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir)
    await this.app.vault.createBinary(p, await createRegister())
    return p
  }

  // Accounts that appear in the register, with the last check number used
  accounts (): RegisterAccount[] {
    const map = new Map<string, RegisterAccount>()
    const bySaved = [...this.entries].sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || ''))
    for (const e of bySaved) {
      const key = accountKey(e)
      const cur = map.get(key)
      if (!cur) {
        map.set(key, {
          key, accountId: e.accountId, label: e.accountLabel, bankName: e.bankName,
          last4: e.accountLast4, lastNumber: e.checkNumber
        })
      } else {
        // Highest number in the same series wins; otherwise the latest saved
        const cmp = compareCheckNumbers(e.checkNumber, cur.lastNumber)
        if (cmp === null || cmp > 0) cur.lastNumber = e.checkNumber
        if (e.accountLabel) cur.label = e.accountLabel
        if (e.bankName) cur.bankName = e.bankName
      }
    }
    return [...map.values()].sort((a, b) => accountName(a).localeCompare(accountName(b)))
  }

  nextNumberFor (key: string) {
    const a = this.accounts().find(x => x.key === key)
    return a?.lastNumber ? nextCheckNumber(a.lastNumber) : ''
  }

  payees () {
    return [...new Set(this.entries.map(e => e.payTo).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }
}
