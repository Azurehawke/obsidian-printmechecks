// Check editor: the Print Me Checks desktop app's main screen, in an Obsidian
// tab. Ribbon (Home / Text / Layout / Accounts), tool rail, the check itself
// (click a field, arrow keys to move it), and a details panel.
import { ItemView, Notice, WorkspaceLeaf, setIcon, Platform, DropdownComponent, Scope } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { Account, accountTitle, last4, blankAccount, DEFAULT_LAYOUT } from './check/model'
import { FIELDS, CHECK_WIDTH } from './check/layout'
import { checkHtml, amountInWords, formatMoney, CHECK_CSS } from './check/render'
import { canPrint } from './check/print'
import { AccountModal } from './accountModal'
import { ConfirmModal } from './modals'
import { PrintPreviewModal, savePdfToVault } from './previewModal'
import { newId, todayString } from './register'

export const EDITOR_VIEW = 'printmechecks-editor'

type Tab = 'Home' | 'Text' | 'Layout' | 'Accounts'

const FONTS = [
  'Arial', 'Book Antiqua', 'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Consolas', 'Courier New',
  'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Lucida Sans', 'Palatino Linotype', 'Segoe UI', 'Tahoma',
  'Times New Roman', 'Trebuchet MS', 'Verdana'
]
const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24]
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

let cssInjected = false
function injectCheckCss () {
  if (cssInjected) return
  const el = document.head.createEl('style', { attr: { id: 'printmechecks-check-css' } })
  el.textContent = CHECK_CSS
  cssInjected = true
}

export class CheckEditorView extends ItemView {
  private tab: Tab = 'Home'
  private selected: string | null = null
  private tool: 'select' | 'pan' = 'select'
  private extraFonts: string[] = []
  private fitZoom = 1
  private ribbonEl!: HTMLElement
  private scrollEl!: HTMLElement
  private zoomEl!: HTMLElement
  private checkEl!: HTMLElement
  private detailsEl!: HTMLElement
  private railEl!: HTMLElement
  private ro?: ResizeObserver

  constructor (leaf: WorkspaceLeaf, private plugin: PrintMeChecksPlugin) {
    super(leaf)
    // Escape deselects a field. Handled in the view's key scope so Obsidian
    // doesn't also act on it (and switch away from the tab).
    this.scope = new Scope(this.app.scope)
    this.scope.register([], 'Escape', () => {
      if (!this.selected) return true
      this.select(null)
      return false
    })
  }

  getViewType () { return EDITOR_VIEW }
  getDisplayText () { return 'Write check' }
  getIcon () { return 'file-pen-line' }

  private get layout () { return this.plugin.settings.layout }
  private get check () { return this.plugin.check }
  private get account (): Account | null { return this.plugin.accounts.active }

  async onOpen () {
    injectCheckCss()
    const root = this.contentEl
    root.empty()
    root.addClass('pmc-editor')
    this.ribbonEl = root.createDiv('pmc-ribbon')
    const ws = root.createDiv('pmc-workspace')
    this.railEl = ws.createDiv('pmc-rail')
    this.scrollEl = ws.createDiv('pmc-canvas-scroll')
    const pad = this.scrollEl.createDiv('pmc-canvas-pad')
    this.zoomEl = pad.createDiv('pmc-canvas-zoom')
    this.checkEl = this.zoomEl.createDiv('pmc-check-box')
    this.detailsEl = ws.createDiv('pmc-details')

    // Click a field to select it (select tool); click empty space to clear
    this.registerDomEvent(this.checkEl, 'click', (e: MouseEvent) => {
      if (this.tool !== 'select') return
      const f = (e.target as HTMLElement).closest('[data-field]') as HTMLElement | null
      this.select(f ? f.dataset.field || null : null)
    })
    this.registerDomEvent(pad, 'click', (e: MouseEvent) => { if (e.target === pad) this.select(null) })
    this.registerDomEvent(this.scrollEl, 'mousedown', (e: MouseEvent) => this.startPan(e))
    this.registerDomEvent(root, 'keydown', (e: KeyboardEvent) => this.onKey(e))
    root.tabIndex = -1

    this.ro = new ResizeObserver(() => this.measureFit())
    this.ro.observe(this.scrollEl)

    this.registerEvent(this.plugin.accounts.on('changed', () => this.renderAll()))
    this.registerEvent(this.plugin.store.on('changed', () => this.renderDetails()))
    this.registerEvent(this.plugin.onCheckChanged(() => this.renderAll()))

    if (!this.plugin.store.loaded) this.plugin.store.reload()
    this.ensureNumber()
    this.renderAll()
  }

  async onClose () {
    this.ro?.disconnect()
  }

  // ---------- Rendering ----------

  renderAll () {
    this.renderRibbon()
    this.renderRail()
    this.renderCheck()
    this.renderDetails()
  }

  private renderCheck () {
    const a = this.account || blankAccount('none')
    this.checkEl.toggleClass('pmc-bg', this.layout.showBackground)
    this.checkEl.toggleClass('pmc-outlines', this.layout.showOutlines)
    this.checkEl.toggleClass('pmc-tool-select', this.tool === 'select')
    this.checkEl.innerHTML = checkHtml(a, this.check, this.layout, { selected: this.selected })
    this.applyZoom()
  }

  private applyZoom () {
    const z = this.layout.zoom === 'fit' ? this.fitZoom : this.layout.zoom
    this.zoomEl.style.setProperty('zoom', String(z))
    this.scrollEl.toggleClass('pmc-panning', this.tool === 'pan')
  }

  private measureFit () {
    const w = this.scrollEl.clientWidth
    if (!w) return
    this.fitZoom = Math.max(0.25, Math.min(1.5, (w - 40) / CHECK_WIDTH))
    this.applyZoom()
  }

  private ribbonButton (parent: HTMLElement, icon: string, label: string, onClick: () => void, opts: { on?: boolean, disabled?: boolean, title?: string } = {}) {
    const b = parent.createEl('button', { cls: 'pmc-rb' + (opts.on ? ' is-on' : ''), attr: { 'aria-label': opts.title || label.replace('\n', ' ') } })
    setIcon(b.createDiv('pmc-rb-icon'), icon)
    const lab = b.createDiv('pmc-rb-label')
    label.split('\n').forEach((l, i) => { if (i) lab.createEl('br'); lab.appendText(l) })
    if (opts.disabled) b.disabled = true
    b.onclick = onClick
    return b
  }

  private group (parent: HTMLElement, label: string) {
    const g = parent.createDiv('pmc-group')
    const items = g.createDiv('pmc-group-items')
    g.createDiv({ cls: 'pmc-group-label', text: label })
    return items
  }

  private accountDropdown (parent: HTMLElement) {
    const d = new DropdownComponent(parent)
    for (const a of this.plugin.accounts.accounts) d.addOption(a.id, accountTitle(a))
    d.addOption('__new', '+ New account…')
    d.setValue(this.account?.id || '__new')
    d.onChange(async v => {
      if (v === '__new') {
        d.setValue(this.account?.id || '__new')
        this.newAccount()
        return
      }
      await this.plugin.accounts.setActive(v)
      this.plugin.setCheck({ checkNumber: this.suggestNumber() })
    })
    d.selectEl.addClass('pmc-account-select')
    return d
  }

  private renderRibbon () {
    const r = this.ribbonEl
    r.empty()
    const tabs = r.createDiv('pmc-tabs')
    for (const t of ['Home', 'Text', 'Layout', 'Accounts'] as Tab[]) {
      const b = tabs.createEl('button', { text: t, cls: 'pmc-tab' + (this.tab === t ? ' is-active' : '') })
      b.onclick = () => { this.tab = t; this.renderRibbon() }
    }
    const reg = tabs.createEl('button', { text: 'Register', cls: 'pmc-tab' })
    reg.onclick = () => this.plugin.openRegister()

    const body = r.createDiv('pmc-ribbon-body')
    const L = this.layout

    if (this.tab === 'Home') {
      const p = this.group(body, 'Print')
      this.ribbonButton(p, 'printer', 'Print…', () => this.print(), { disabled: !canPrint(), title: canPrint() ? 'Print preview' : 'Printing needs Obsidian on a computer' })
      this.ribbonButton(p, 'file-down', 'Save PDF', () => this.savePdf(), { disabled: !canPrint() })
      const c = this.group(body, 'Check')
      this.ribbonButton(c, 'file-plus', 'New Check', () => this.newCheck())
      this.ribbonButton(c, 'book-plus', 'Save to\nRegister', () => this.saveToRegister())
      const a = this.group(body, 'Account')
      a.addClass('pmc-col')
      this.accountDropdown(a)
      const e = a.createEl('button', { cls: 'pmc-small', text: 'Edit account' })
      e.onclick = () => this.editAccount()
    } else if (this.tab === 'Text') {
      const f = this.group(body, 'Font (whole check)')
      f.addClass('pmc-col')
      const row1 = f.createDiv('pmc-row')
      const fd = new DropdownComponent(row1)
      fd.addOption('', 'Default')
      const fonts = [...new Set([...FONTS, ...this.extraFonts, ...(L.fontFamily ? [L.fontFamily] : [])])].sort((x, y) => x.localeCompare(y))
      for (const name of fonts) fd.addOption(name, name)
      fd.setValue(L.fontFamily).onChange(v => this.setLayout({ fontFamily: v }))
      fd.selectEl.addClass('pmc-font-select')
      const sd = new DropdownComponent(row1)
      for (const s of SIZES) sd.addOption(String(s), String(s))
      if (!SIZES.includes(L.fontSize)) sd.addOption(String(L.fontSize), String(L.fontSize))
      sd.setValue(String(L.fontSize)).onChange(v => this.setLayout({ fontSize: parseInt(v) }))
      const row2 = f.createDiv('pmc-row')
      this.smallIcon(row2, 'a-arrow-down', 'Smaller', () => this.bumpFont(-1))
      this.smallIcon(row2, 'a-arrow-up', 'Larger', () => this.bumpFont(1))
      this.smallIcon(row2, 'bold', 'Bold filled-in values', () => this.setLayout({ boldValues: !L.boldValues }), L.boldValues)
      if ('queryLocalFonts' in window) {
        const b = row2.createEl('button', { cls: 'pmc-small', text: 'Installed fonts' })
        b.onclick = () => this.loadLocalFonts()
      }
      const rs = this.group(body, 'Reset')
      this.ribbonButton(rs, 'rotate-ccw', 'Reset\nFont', () => this.setLayout({ fontFamily: DEFAULT_LAYOUT.fontFamily, fontSize: DEFAULT_LAYOUT.fontSize, boldValues: DEFAULT_LAYOUT.boldValues }))
    } else if (this.tab === 'Layout') {
      const m = this.group(body, 'Move Field')
      const pad = m.createDiv('pmc-nudge')
      const dis = !this.selected
      const cell = (icon: string | null, dx: number, dy: number, title: string) => {
        if (!icon) { pad.createSpan(); return }
        const b = pad.createEl('button', { cls: 'pmc-small', attr: { 'aria-label': title } })
        setIcon(b, icon)
        b.disabled = dis
        b.onclick = () => (dx || dy) ? this.nudge(dx, dy) : this.resetField()
      }
      cell(null, 0, 0, ''); cell('arrow-up', 0, -1, 'Up'); cell(null, 0, 0, '')
      cell('arrow-left', -1, 0, 'Left'); cell('crosshair', 0, 0, 'Reset this field'); cell('arrow-right', 1, 0, 'Right')
      cell(null, 0, 0, ''); cell('arrow-down', 0, 1, 'Down'); cell(null, 0, 0, '')
      const info = m.createDiv('pmc-sel-info')
      info.createEl('strong', { text: this.selected ? FIELDS[this.selected].label : 'No field selected' })
      info.createDiv({ text: this.selected ? 'Arrow keys move it; Shift+arrow 10×.' : 'Click a field on the check to move it.' })

      const sh = this.group(body, 'Shift Whole Check')
      sh.addClass('pmc-col')
      this.inchInput(sh, 'Right', L.offsetX, v => this.setLayout({ offsetX: v }))
      this.inchInput(sh, 'Down', L.offsetY, v => this.setLayout({ offsetY: v }))

      const show = this.group(body, 'Show (screen only)')
      this.ribbonButton(show, 'image', 'Background', () => this.setLayout({ showBackground: !L.showBackground }), { on: L.showBackground })
      this.ribbonButton(show, 'scan', 'Outlines', () => this.setLayout({ showOutlines: !L.showOutlines }), { on: L.showOutlines })

      const pr = this.group(body, 'Print')
      this.ribbonButton(pr, 'receipt', 'Check stub', () => this.setLayout({ showStub: !L.showStub }), { on: L.showStub })

      const rs = this.group(body, 'Reset')
      this.ribbonButton(rs, 'rotate-ccw', 'Reset\nLayout', () => new ConfirmModal(this.app, 'Reset layout?',
        'Put every field back in its default position and clear the whole-check shift.', 'Reset',
        () => this.setLayout({ fieldOffsets: {}, offsetX: 0, offsetY: 0 })).open())
    } else {
      const a = this.group(body, 'Active Account')
      a.addClass('pmc-col')
      this.accountDropdown(a)
      const n = this.plugin.accounts.accounts.length
      a.createSpan({ cls: 'pmc-muted', text: `${n} saved account${n === 1 ? '' : 's'} · ${this.plugin.settings.accountStorage === 'vault' ? 'synced with vault' : 'this device only'}` })
      const mg = this.group(body, 'Manage')
      this.ribbonButton(mg, 'square-plus', 'New', () => this.newAccount())
      this.ribbonButton(mg, 'square-pen', 'Edit', () => this.editAccount(), { disabled: !this.account })
      this.ribbonButton(mg, 'copy', 'Duplicate', () => this.duplicateAccount(), { disabled: !this.account })
      this.ribbonButton(mg, 'trash-2', 'Delete', () => this.deleteAccount(), { disabled: !this.account })
      const ie = this.group(body, 'Transfer')
      this.ribbonButton(ie, 'download', 'Import…', () => this.plugin.importAccountsFromFile())
      this.ribbonButton(ie, 'upload', 'Export…', () => this.plugin.exportAccountsToFile(), { disabled: !Platform.isDesktopApp || !n })
    }
  }

  private smallIcon (parent: HTMLElement, icon: string, title: string, onClick: () => void, on = false) {
    const b = parent.createEl('button', { cls: 'pmc-small' + (on ? ' is-on' : ''), attr: { 'aria-label': title } })
    setIcon(b, icon)
    b.onclick = onClick
    return b
  }

  private inchInput (parent: HTMLElement, label: string, value: number, onChange: (v: number) => void) {
    const row = parent.createEl('label', { cls: 'pmc-inch' })
    row.createSpan({ text: label })
    const i = row.createEl('input', { type: 'number', value: String(value) })
    i.step = '0.01'
    i.onchange = () => onChange(parseFloat(i.value) || 0)
    row.createSpan({ text: 'in' })
  }

  private renderRail () {
    const r = this.railEl
    r.empty()
    const btn = (icon: string, title: string, onClick: () => void, on = false, disabled = false) => {
      const b = r.createEl('button', { cls: 'pmc-rail-btn' + (on ? ' is-on' : ''), attr: { 'aria-label': title } })
      setIcon(b, icon)
      b.disabled = disabled
      b.onclick = onClick
    }
    btn('mouse-pointer-2', 'Select and move fields (V)', () => this.setTool('select'), this.tool === 'select')
    btn('hand', 'Pan: drag to scroll (H)', () => this.setTool('pan'), this.tool === 'pan')
    r.createEl('hr')
    btn('zoom-in', 'Zoom in', () => this.zoomStep(1))
    btn('zoom-out', 'Zoom out', () => this.zoomStep(-1))
    btn('maximize', 'Fit to window', () => this.setLayout({ zoom: 'fit' }), this.layout.zoom === 'fit')
    r.createEl('hr')
    btn('scan', 'Show field outlines', () => this.setLayout({ showOutlines: !this.layout.showOutlines }), this.layout.showOutlines)
    btn('image', 'Show check background (never printed)', () => this.setLayout({ showBackground: !this.layout.showBackground }), this.layout.showBackground)
    r.createEl('hr')
    btn('printer', 'Print preview', () => this.print(), false, !canPrint())
  }

  private renderDetails () {
    const d = this.detailsEl
    if (!d) return
    // Don't rebuild while the user is typing in the panel
    if (d.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') return
    d.empty()
    const a = this.account

    const s1 = d.createDiv('pmc-sect-box')
    s1.createEl('h6', { text: 'Account' })
    if (!a) {
      s1.createEl('p', { cls: 'pmc-muted', text: 'Add the bank account to print from, or import your accounts from the desktop app (Accounts → Export there).' })
      const row = s1.createDiv('pmc-btn-col')
      const n = row.createEl('button', { text: 'New account…', cls: 'mod-cta' })
      n.onclick = () => this.newAccount()
      const i = row.createEl('button', { text: 'Import from the app…' })
      i.onclick = () => this.plugin.importAccountsFromFile()
      return
    }
    this.accountDropdown(s1)
    s1.createDiv({ cls: 'pmc-acct-summary', text: a.holderName || 'No name' })
    s1.createDiv({ cls: 'pmc-muted', text: `${a.bankName} ${last4(a.accountNumber)}` })
    const ed = s1.createEl('a', { text: 'Edit account details', href: '#' })
    ed.onclick = (e) => { e.preventDefault(); this.editAccount() }

    const s2 = d.createDiv('pmc-sect-box')
    s2.createEl('h6', { text: 'Check' })
    const grid = s2.createDiv('pmc-grid2')
    const numWrap = this.field(grid, 'Check #', this.check.checkNumber, v => this.plugin.setCheck({ checkNumber: v }, true))
    const numInput = numWrap.querySelector('input')
    if (numInput) {
      let numberOnFocus = ''
      numInput.addEventListener('focus', () => { numberOnFocus = this.check.checkNumber })
      numInput.addEventListener('change', () => this.plugin.lookupCheckNumber(numberOnFocus))
    }
    const dateWrap = this.field(grid, 'Date', this.check.date, v => this.plugin.setCheck({ date: v }, true))
    const today = dateWrap.createEl('button', { cls: 'pmc-small', attr: { 'aria-label': 'Today' } })
    setIcon(today, 'calendar-check')
    today.onclick = () => { this.plugin.setCheck({ date: todayString() }); this.renderDetails() }

    const payee = this.field(s2, 'Pay to the order of', this.check.payTo, v => this.plugin.setCheck({ payTo: v }, true))
    const input = payee.querySelector('input') as HTMLInputElement
    const listId = 'pmc-payees-' + newId()
    const list = payee.createEl('datalist', { attr: { id: listId } })
    for (const p of this.plugin.store.payees()) list.createEl('option', { value: p })
    input.setAttr('list', listId)
    input.placeholder = 'Payee'

    const amt = this.field(s2, 'Amount ($)', this.check.amount, v => { this.plugin.setCheck({ amount: v }, true); words.setText(amountInWords(v) || '—') })
    const amtInput = amt.querySelector('input') as HTMLInputElement
    amtInput.inputMode = 'decimal'
    // Tidy the amount on leaving the field. Silent update: rebuilding the
    // panel here would steal focus from the field the user is moving to.
    amtInput.addEventListener('blur', () => {
      this.plugin.setCheck({ amount: formatMoney(amtInput.value).replace(/,/g, '') }, true)
      amtInput.value = this.check.amount
      this.renderCheck()
    })
    const words = s2.createDiv({ cls: 'pmc-words', text: amountInWords(this.check.amount) || '—' })
    this.field(s2, 'Memo', this.check.memo, v => this.plugin.setCheck({ memo: v }, true))

    const s3 = d.createDiv('pmc-sect-box pmc-btn-col')
    if (canPrint()) {
      const p = s3.createEl('button', { cls: 'mod-cta' })
      setIcon(p.createSpan('pmc-btn-icon'), 'printer'); p.appendText(' Print…')
      p.onclick = () => this.print()
    }
    const sv = s3.createEl('button')
    setIcon(sv.createSpan('pmc-btn-icon'), 'book-plus'); sv.appendText(' Save to Register')
    sv.onclick = () => this.saveToRegister()
    const nc = s3.createEl('button')
    setIcon(nc.createSpan('pmc-btn-icon'), 'file-plus'); nc.appendText(' New Check')
    nc.onclick = () => this.newCheck()

    if (this.selected) {
      const s4 = d.createDiv('pmc-sect-box pmc-selected-box')
      s4.createEl('h6', { text: 'Selected field' })
      s4.createEl('strong', { text: FIELDS[this.selected].label })
      s4.createDiv({ cls: 'pmc-muted', text: 'Arrow keys move it 1px, Shift+arrow 10px. Esc deselects.' })
      const r = s4.createEl('a', { text: 'Reset this field', href: '#' })
      r.onclick = (e) => { e.preventDefault(); this.resetField() }
    }
  }

  private field (parent: HTMLElement, label: string, value: string, onInput: (v: string) => void) {
    const wrap = parent.createDiv('pmc-field')
    wrap.createEl('label', { text: label })
    const row = wrap.createDiv('pmc-field-row')
    const i = row.createEl('input', { type: 'text', value })
    i.oninput = () => { onInput(i.value); this.renderCheck() }
    return row
  }

  // ---------- Actions ----------

  private setLayout (patch: Partial<typeof DEFAULT_LAYOUT>) {
    Object.assign(this.plugin.settings.layout, patch)
    this.plugin.saveSettings()
    this.renderAll()
  }

  private setTool (t: 'select' | 'pan') {
    this.tool = t
    if (t === 'pan') this.selected = null
    this.renderAll()
  }

  private select (key: string | null) {
    this.selected = key
    this.renderCheck()
    this.renderDetails()
    if (this.tab === 'Layout') this.renderRibbon()
    this.contentEl.focus()
  }

  private nudge (dx: number, dy: number) {
    if (!this.selected) return
    const offs = { ...this.layout.fieldOffsets }
    const cur = offs[this.selected] || { x: 0, y: 0 }
    offs[this.selected] = { x: cur.x + dx, y: cur.y + dy }
    this.layout.fieldOffsets = offs
    this.plugin.saveSettings()
    this.renderCheck()
  }

  private resetField () {
    if (!this.selected) return
    const offs = { ...this.layout.fieldOffsets }
    delete offs[this.selected]
    this.setLayout({ fieldOffsets: offs })
  }

  private bumpFont (d: number) {
    const cur = this.layout.fontSize
    const i = SIZES.indexOf(cur)
    this.setLayout({ fontSize: i < 0 ? cur + d : SIZES[Math.min(SIZES.length - 1, Math.max(0, i + d))] })
  }

  private async loadLocalFonts () {
    try {
      const list = await (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts()
      this.extraFonts = [...new Set(list.map(f => f.family))]
      new Notice(`Added ${this.extraFonts.length} installed font families.`)
      this.renderRibbon()
    } catch {
      new Notice('Could not read the installed fonts.')
    }
  }

  private zoomStep (dir: number) {
    const cur = this.layout.zoom === 'fit' ? this.fitZoom : this.layout.zoom
    const next = dir > 0 ? ZOOMS.find(z => z > cur + 0.001) : [...ZOOMS].reverse().find(z => z < cur - 0.001)
    this.setLayout({ zoom: next ?? cur })
  }

  private startPan (e: MouseEvent) {
    if (this.tool !== 'pan') return
    const el = this.scrollEl
    const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    const move = (ev: MouseEvent) => {
      el.scrollLeft = start.left - (ev.clientX - start.x)
      el.scrollTop = start.top - (ev.clientY - start.y)
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    e.preventDefault()
  }

  private onKey (e: KeyboardEvent) {
    const t = e.target as HTMLElement
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return
    const step = e.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }
    if (this.selected && moves[e.key]) {
      e.preventDefault()
      this.nudge(...moves[e.key])
    } else if (e.key.toLowerCase() === 'v') {
      this.setTool('select')
    } else if (e.key.toLowerCase() === 'h') {
      this.setTool('pan')
    }
  }

  // Next number for the active account: the account's own next number, or
  // the register's (if checks were saved elsewhere since), whichever is later.
  suggestNumber () {
    return this.plugin.suggestNumber(this.account)
  }

  private ensureNumber () {
    if (!this.check.checkNumber && this.account) this.plugin.setCheck({ checkNumber: this.suggestNumber() })
  }

  newCheck () {
    this.plugin.setCheck({ checkNumber: this.suggestNumber(), date: todayString(), payTo: '', amount: '0.00', memo: '' })
  }

  saveToRegister () {
    return this.plugin.saveCheckToRegister()
  }

  print () {
    if (!this.requireAccount()) return
    new PrintPreviewModal(this.app, this.plugin).open()
  }

  private async savePdf () {
    if (!this.requireAccount()) return
    await savePdfToVault(this.plugin)
  }

  private requireAccount () {
    if (this.account) return true
    new Notice('Add a bank account first.')
    this.newAccount()
    return false
  }

  private newAccount () {
    new AccountModal(this.app, this.plugin, blankAccount(newId()), () => this.plugin.setCheck({ checkNumber: this.suggestNumber() })).open()
  }

  private editAccount () {
    if (this.account) new AccountModal(this.app, this.plugin, this.account).open()
  }

  private duplicateAccount () {
    const a = this.account
    if (!a) return
    new AccountModal(this.app, this.plugin, { ...a, id: newId(), label: (a.label || accountTitle(a)) + ' (copy)' }).open()
  }

  private deleteAccount () {
    const a = this.account
    if (!a) return
    new ConfirmModal(this.app, `Delete ${accountTitle(a)}?`, 'Checks already in the register are kept.', 'Delete',
      () => this.plugin.accounts.remove(a.id)).open()
  }
}
