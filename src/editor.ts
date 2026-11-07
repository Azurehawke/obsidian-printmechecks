// Check editor: the Print Me Checks desktop app's main screen, in an Obsidian
// tab. Ribbon (Home / Text / Layout / Accounts), tool rail, the check itself
// (click a field, arrow keys to move it), and a details panel.
import { ItemView, Notice, WorkspaceLeaf, setIcon, Platform, DropdownComponent, Scope } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { Account, accountTitle, last4, blankAccount, DEFAULT_LAYOUT, FieldOffset } from './check/model'
import { FIELDS, CHECK_WIDTH, PX_PER_MM } from './check/layout'

const round1 = (v: number) => Math.round(v * 10) / 10
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
  // Every selected field; selected is the first (kept for single-field code)
  private selection: string[] = []
  private marqueeRect: { x0: number, y0: number, x1: number, y1: number } | null = null
  private get selected (): string | null { return this.selection[0] ?? null }
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
      if (!this.selection.length) return true
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

    // Drag a field (or the selected group); drag empty check area to select a box
    this.registerDomEvent(this.checkEl, 'mousedown', (e: MouseEvent) => this.onCheckDown(e))
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
    this.checkEl.innerHTML = checkHtml(a, this.check, this.layout, { selected: this.selection }) +
      this.gridHtml() + this.marqueeHtml()
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
      info.createEl('strong', { text: this.selection.length > 1 ? `${this.selection.length} fields selected` : (this.selected ? FIELDS[this.selected].label : 'No field selected') })
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

      const gr = this.group(body, 'Grid & snap')
      this.ribbonButton(gr, 'grid', 'Grid', () => this.setLayout({ showGrid: !L.showGrid }), { on: L.showGrid })
      this.ribbonButton(gr, 'magnet', 'Snap', () => this.setLayout({ snap: !L.snap }), { on: L.snap })
      this.ribbonButton(gr, 'ruler', `${L.gridMm} mm`, () => this.cycleGrid(), { title: 'Grid spacing (click to change)' })

      const multi = this.selection.length >= 2
      const al = this.group(body, 'Align (2+ fields)')
      this.ribbonButton(al, 'align-start-vertical', 'Left', () => this.align('left'), { disabled: !multi })
      this.ribbonButton(al, 'align-center-vertical', 'Centre', () => this.align('hcenter'), { disabled: !multi })
      this.ribbonButton(al, 'align-end-vertical', 'Right', () => this.align('right'), { disabled: !multi })
      this.ribbonButton(al, 'align-start-horizontal', 'Top', () => this.align('top'), { disabled: !multi })
      this.ribbonButton(al, 'align-center-horizontal', 'Middle', () => this.align('vcenter'), { disabled: !multi })
      this.ribbonButton(al, 'align-end-horizontal', 'Bottom', () => this.align('bottom'), { disabled: !multi })
      this.ribbonButton(al, 'move-horizontal', 'Space H', () => this.distribute('h'), { disabled: this.selection.length < 3, title: 'Space evenly horizontally (3+ fields)' })
      this.ribbonButton(al, 'move-vertical', 'Space V', () => this.distribute('v'), { disabled: this.selection.length < 3, title: 'Space evenly vertically (3+ fields)' })

      const lf = this.group(body, 'Layout file')
      this.ribbonButton(lf, 'download', 'Export\nLayout', () => this.plugin.exportLayoutToFile(), { title: 'Save this check layout to a file (opens in the desktop app too)' })
      this.ribbonButton(lf, 'upload', 'Import\nLayout', () => this.plugin.importLayoutFromFile(), { title: 'Load a check layout from a file' })

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

    if (this.selection.length > 1) {
      const s5 = d.createDiv('pmc-sect-box pmc-selected-box')
      s5.createEl('h6', { text: `${this.selection.length} fields selected` })
      s5.createDiv({ cls: 'pmc-muted', text: 'Align and space them from the Layout tab.' })
    }
    if (this.selection.length === 1) {
      const s4 = d.createDiv('pmc-sect-box pmc-selected-box')
      s4.createEl('h6', { text: 'Selected field' })
      s4.createEl('strong', { text: FIELDS[this.selection[0]].label })
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
    if (t === 'pan') this.selection = []
    this.renderAll()
  }

  private select (key: string | null) {
    this.selection = key ? [key] : []
    this.renderCheck()
    this.renderDetails()
    if (this.tab === 'Layout') this.renderRibbon()
    this.contentEl.focus()
  }

  private nudge (dx: number, dy: number) {
    if (!this.selection.length) return
    const offs = { ...this.layout.fieldOffsets }
    for (const k of this.selection) {
      const cur = offs[k] || { x: 0, y: 0 }
      offs[k] = { x: cur.x + dx, y: cur.y + dy }
    }
    this.layout.fieldOffsets = offs
    this.plugin.saveSettings()
    this.renderCheck()
  }

  private resetField () {
    if (!this.selection.length) return
    const offs = { ...this.layout.fieldOffsets }
    for (const k of this.selection) delete offs[k]
    this.setLayout({ fieldOffsets: offs })
  }

  // ---------- Selection, drag, grid, align ----------

  private get scale () { return this.checkEl.getBoundingClientRect().width / CHECK_WIDTH }

  private isAdditive (e: MouseEvent) { return e.shiftKey || e.ctrlKey || e.metaKey }

  private afterSelection () {
    this.renderCheck()
    this.renderDetails()
    if (this.tab === 'Layout') this.renderRibbon()
  }

  private onCheckDown (e: MouseEvent) {
    if (this.tool !== 'select' || e.button !== 0) return
    const f = (e.target as HTMLElement).closest('[data-field]') as HTMLElement | null
    if (f?.dataset.field) this.startFieldDrag(f.dataset.field, e)
    else this.startMarquee(e)
  }

  // Drag a field, or every selected field together. With snapping on, the
  // field under the mouse lands on the grid and the rest keep their spacing.
  private startFieldDrag (key: string, e: MouseEvent) {
    e.preventDefault()
    if (this.isAdditive(e)) {
      this.selection = this.selection.includes(key) ? this.selection.filter(k => k !== key) : [...this.selection, key]
      this.afterSelection()
      return
    }
    if (!this.selection.includes(key)) this.selection = [key]
    const group = [...this.selection]
    const scale = this.scale
    const sx = e.clientX
    const sy = e.clientY
    const anchor = FIELDS[key]
    const aoff = this.layout.fieldOffsets[key] || { x: 0, y: 0 }
    const aStart = { x: anchor.left + aoff.x, y: anchor.top + aoff.y }
    const origin: Record<string, FieldOffset> = {}
    for (const k of group) origin[k] = { ...(this.layout.fieldOffsets[k] || { x: 0, y: 0 }) }
    let moved = false
    const move = (ev: MouseEvent) => {
      let dx = (ev.clientX - sx) / scale
      let dy = (ev.clientY - sy) / scale
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
      if (this.layout.snap) {
        const step = this.layout.gridMm * PX_PER_MM
        dx = Math.round((aStart.x + dx) / step) * step - aStart.x
        dy = Math.round((aStart.y + dy) / step) * step - aStart.y
      }
      const next = { ...this.layout.fieldOffsets }
      for (const k of group) next[k] = { x: round1(origin[k].x + dx), y: round1(origin[k].y + dy) }
      this.layout.fieldOffsets = next
      this.renderCheck()
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (moved) this.plugin.saveSettings()
      else if (group.length > 1) this.selection = [key]
      this.afterSelection()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Drag on empty check area to select every field the box touches
  private startMarquee (e: MouseEvent) {
    e.preventDefault()
    const rect = this.checkEl.getBoundingClientRect()
    const scale = this.scale
    const toCanvas = (x: number, y: number) => ({ x: (x - rect.left) / scale, y: (y - rect.top) / scale })
    const start = toCanvas(e.clientX, e.clientY)
    const additive = this.isAdditive(e)
    const before = [...this.selection]
    let moved = false
    const move = (ev: MouseEvent) => {
      const p = toCanvas(ev.clientX, ev.clientY)
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 4) return
      moved = true
      const r = { x0: Math.min(start.x, p.x), y0: Math.min(start.y, p.y), x1: Math.max(start.x, p.x), y1: Math.max(start.y, p.y) }
      this.marqueeRect = r
      const hit = Array.from(this.checkEl.querySelectorAll<HTMLElement>('[data-field]')).filter(el => {
        const f = el.getBoundingClientRect()
        const l = (f.left - rect.left) / scale
        const t = (f.top - rect.top) / scale
        const rt = (f.right - rect.left) / scale
        const b = (f.bottom - rect.top) / scale
        return l < r.x1 && rt > r.x0 && t < r.y1 && b > r.y0
      }).map(el => el.dataset.field as string)
      this.selection = additive ? [...new Set([...before, ...hit])] : hit
      this.renderCheck()
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      this.marqueeRect = null
      if (!moved && !additive) this.selection = []
      this.afterSelection()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  private marqueeHtml () {
    const r = this.marqueeRect
    if (!r) return '<div class="pmc-marquee" style="display:none"></div>'
    return `<div class="pmc-marquee" style="left:${r.x0}px;top:${r.y0}px;width:${r.x1 - r.x0}px;height:${r.y1 - r.y0}px"></div>`
  }

  // Millimetre grid with labels every 10 mm (screen only, never printed)
  private gridHtml () {
    if (!this.layout.showGrid) return ''
    const step = this.layout.gridMm * PX_PER_MM
    let labels = ''
    for (let mm = 0; mm * PX_PER_MM < CHECK_WIDTH; mm += 10) {
      labels += `<span class="pmc-mm" style="left:${mm * PX_PER_MM}px;top:0">${mm}</span>`
    }
    for (let mm = 10; mm * PX_PER_MM < 480; mm += 10) {
      labels += `<span class="pmc-mm" style="top:${mm * PX_PER_MM}px;left:0">${mm}</span>`
    }
    return `<div class="pmc-grid" style="background-size:${step}px ${step}px">${labels}</div>`
  }

  // A field's box on the check in canvas px, measured from the rendered page
  private measureField (key: string) {
    const el = this.checkEl.querySelector<HTMLElement>(`[data-field="${key}"]`)
    if (!el) return null
    const scale = this.scale
    const r = el.getBoundingClientRect()
    const base = FIELDS[key]
    const off = this.layout.fieldOffsets[key] || { x: 0, y: 0 }
    return { key, l: base.left + off.x, t: base.top + off.y, w: r.width / scale, h: r.height / scale }
  }

  private measureSelection () {
    return this.selection.map(k => this.measureField(k)).filter((m): m is NonNullable<ReturnType<typeof this.measureField>> => !!m)
  }

  // Absolute left/top edges (canvas px) for each field
  private setEdges (moves: Record<string, { x?: number, y?: number }>) {
    const next = { ...this.layout.fieldOffsets }
    for (const [key, p] of Object.entries(moves)) {
      const base = FIELDS[key]
      const cur = next[key] || { x: 0, y: 0 }
      next[key] = {
        x: p.x !== undefined ? Math.round(p.x - base.left) : cur.x,
        y: p.y !== undefined ? Math.round(p.y - base.top) : cur.y
      }
    }
    this.layout.fieldOffsets = next
    this.plugin.saveSettings()
    this.renderCheck()
  }

  private align (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const items = this.measureSelection()
    if (items.length < 2) return
    const minL = Math.min(...items.map(i => i.l))
    const maxR = Math.max(...items.map(i => i.l + i.w))
    const minT = Math.min(...items.map(i => i.t))
    const maxB = Math.max(...items.map(i => i.t + i.h))
    const moves: Record<string, { x?: number, y?: number }> = {}
    for (const i of items) {
      if (mode === 'left') moves[i.key] = { x: minL }
      else if (mode === 'right') moves[i.key] = { x: maxR - i.w }
      else if (mode === 'hcenter') moves[i.key] = { x: (minL + maxR) / 2 - i.w / 2 }
      else if (mode === 'top') moves[i.key] = { y: minT }
      else if (mode === 'bottom') moves[i.key] = { y: maxB - i.h }
      else moves[i.key] = { y: (minT + maxB) / 2 - i.h / 2 }
    }
    this.setEdges(moves)
  }

  // Space the selected fields evenly, keeping the outermost two in place
  private distribute (axis: 'h' | 'v') {
    const horiz = axis === 'h'
    const pos = (i: { l: number, t: number }) => (horiz ? i.l : i.t)
    const size = (i: { w: number, h: number }) => (horiz ? i.w : i.h)
    const items = this.measureSelection().sort((a, b) => pos(a) - pos(b))
    if (items.length < 3) return
    const start = pos(items[0])
    const end = Math.max(...items.map(i => pos(i) + size(i)))
    const total = items.reduce((sum, i) => sum + size(i), 0)
    const gap = (end - start - total) / (items.length - 1)
    const moves: Record<string, { x?: number, y?: number }> = {}
    let cursor = start
    for (const i of items) {
      moves[i.key] = horiz ? { x: cursor } : { y: cursor }
      cursor += size(i) + gap
    }
    this.setEdges(moves)
  }

  private cycleGrid () {
    const steps = [0.5, 1, 2.5, 5]
    const i = steps.indexOf(this.layout.gridMm)
    this.setLayout({ gridMm: steps[(i + 1) % steps.length] })
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
      e.preventDefault()
      this.selection = Object.keys(FIELDS)
      this.afterSelection()
      return
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return
    const step = e.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }
    if (this.selection.length && moves[e.key]) {
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
