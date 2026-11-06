import { Plugin, TAbstractFile, TFile, normalizePath } from 'obsidian'
import { DEFAULT_SETTINGS, Settings, SettingsTab } from './settings'
import { RegisterStore } from './store'
import { RegisterView, VIEW_TYPE } from './view'
import { RecordCheckModal } from './modals'
import { registerChecksBlock } from './codeblock'

export default class PrintMeChecksPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS }
  store!: RegisterStore

  async onload () {
    await this.loadSettings()
    this.store = new RegisterStore(this.app, () => this.settings.registerPath)

    this.registerView(VIEW_TYPE, leaf => new RegisterView(leaf, this))
    registerChecksBlock(this)
    this.addSettingTab(new SettingsTab(this.app, this))

    this.addRibbonIcon('landmark', 'Open check register', () => this.openRegister())
    this.addCommand({ id: 'open-register', name: 'Open check register', callback: () => this.openRegister() })
    this.addCommand({ id: 'record-check', name: 'Record a check', callback: () => new RecordCheckModal(this.app, this).open() })
    this.addCommand({ id: 'reload-register', name: 'Reload check register', callback: () => this.store.reload() })

    // Keep in step with the file: edits from the desktop app, Excel, sync…
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

    this.app.workspace.onLayoutReady(() => this.store.reload())
  }

  async openRegister () {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
    const leaf = existing ?? this.app.workspace.getLeaf('tab')
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true })
    this.app.workspace.revealLeaf(leaf)
  }

  openSettings () {
    const setting = (this.app as unknown as { setting: { open: () => void, openTabById: (id: string) => void } }).setting
    setting.open()
    setting.openTabById(this.manifest.id)
  }

  async loadSettings () {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) }
  }

  async saveSettings () {
    await this.saveData(this.settings)
  }
}
