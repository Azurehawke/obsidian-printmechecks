import { AbstractInputSuggest, App, Notice, PluginSettingTab, Setting, TFile } from 'obsidian'
import type PrintMeChecksPlugin from './main'

export interface Settings {
  registerPath: string
  lastAccountKey: string
}

export const DEFAULT_SETTINGS: Settings = {
  registerPath: '',
  lastAccountKey: ''
}

class XlsxSuggest extends AbstractInputSuggest<TFile> {
  constructor (app: App, private input: HTMLInputElement, private onPick: (f: TFile) => void) {
    super(app, input)
  }

  getSuggestions (q: string) {
    const needle = q.toLowerCase()
    return this.app.vault.getFiles()
      .filter(f => f.extension.toLowerCase() === 'xlsx' && f.path.toLowerCase().includes(needle))
      .slice(0, 50)
  }

  renderSuggestion (f: TFile, el: HTMLElement) {
    el.setText(f.path)
  }

  selectSuggestion (f: TFile) {
    this.input.value = f.path
    this.onPick(f)
    this.close()
  }
}

export class SettingsTab extends PluginSettingTab {
  constructor (app: App, private plugin: PrintMeChecksPlugin) {
    super(app, plugin)
  }

  display () {
    const c = this.containerEl
    c.empty()
    const store = this.plugin.store

    new Setting(c)
      .setName('Register file')
      .setDesc('The .xlsx check register shared with the Print Me Checks desktop app (Register → New File / Open File there).')
      .addText(t => {
        t.setPlaceholder('Finances/Check Register.xlsx').setValue(this.plugin.settings.registerPath)
        const save = async (v: string) => {
          this.plugin.settings.registerPath = v.trim()
          await this.plugin.saveSettings()
          await store.reload()
          this.display()
        }
        new XlsxSuggest(this.app, t.inputEl, f => save(f.path))
        t.inputEl.addEventListener('change', () => save(t.inputEl.value))
        t.inputEl.style.width = '100%'
      })

    const status = c.createDiv('pmc-settings-status')
    if (!this.plugin.settings.registerPath) status.setText('No register file set yet.')
    else if (store.error) status.setText('⚠ ' + store.error)
    else status.setText(`✓ ${store.entries.length} check${store.entries.length === 1 ? '' : 's'} in the register.`)

    let newPath = 'Check Register.xlsx'
    new Setting(c)
      .setName('Create a new register')
      .setDesc('Makes an empty register in the vault and uses it. If you already use the desktop app, point it at the same file with Register → Open File.')
      .addText(t => t.setValue(newPath).onChange(v => (newPath = v)))
      .addButton(b => b.setButtonText('Create').onClick(async () => {
        try {
          const p = await store.createFile(newPath.trim() || 'Check Register.xlsx')
          this.plugin.settings.registerPath = p
          await this.plugin.saveSettings()
          await store.reload()
          new Notice(`Created ${p}`)
          this.display()
        } catch (e) {
          new Notice('Could not create the register: ' + (e as Error).message)
        }
      }))

    c.createEl('h3', { text: 'Embedding in notes' })
    const ex = c.createEl('pre')
    ex.setText('```checks\nstatus: Issued\naccount: Business\nfrom: 1/1/2026\nsort: date\ncolumns: date, number, payee, amount, memo\n```')
    c.createEl('p', {
      cls: 'setting-item-description',
      text: 'Options: status, account, payee, from, to, limit, sort (date/number/amount/payee, add "asc"), columns (date, number, payee, amount, memo, status, account), total (true/false).'
    })
  }
}
