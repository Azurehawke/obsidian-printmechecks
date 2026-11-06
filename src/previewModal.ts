import { App, Modal, Notice, loadPdfJs, normalizePath } from 'obsidian'
import type PrintMeChecksPlugin from './main'
import { printDocument } from './check/render'
import { renderPdf, printWithDialog, chooseSavePath, writeFile, safeFileName } from './check/print'

function checkFileName (plugin: PrintMeChecksPlugin) {
  const c = plugin.check
  return safeFileName(`Check ${c.checkNumber || ''} ${c.payTo || ''}`) + '.pdf'
}

function currentHtml (plugin: PrintMeChecksPlugin) {
  const a = plugin.accounts.active
  if (!a) throw new Error('No account selected.')
  return printDocument(a, plugin.check, plugin.settings.layout)
}

// Save the check as a PDF in the vault (Settings → PDF folder).
export async function savePdfToVault (plugin: PrintMeChecksPlugin, pdf?: Uint8Array) {
  try {
    const data = pdf ?? await renderPdf(currentHtml(plugin))
    const vault = plugin.app.vault
    const folder = normalizePath(plugin.settings.pdfFolder || 'Checks')
    if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder)
    const base = checkFileName(plugin).replace(/\.pdf$/, '')
    let path = normalizePath(`${folder}/${base}.pdf`)
    for (let i = 2; vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${base} (${i}).pdf`)
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    await vault.createBinary(path, buf)
    new Notice(`Saved ${path}`)
    return path
  } catch (e) {
    new Notice('Could not save the PDF: ' + (e as Error).message)
    return null
  }
}

// Print preview: shows the exact PDF that will print, with Print and Save.
export class PrintPreviewModal extends Modal {
  private pdf: Uint8Array | null = null
  private html = ''

  constructor (app: App, private plugin: PrintMeChecksPlugin) {
    super(app)
  }

  async onOpen () {
    this.modalEl.addClass('pmc-preview-modal')
    this.titleEl.setText('Print preview')
    const bar = this.contentEl.createDiv('pmc-preview-bar')
    bar.createSpan({ cls: 'pmc-muted', text: 'Letter, no margins, 100% scale. The check background never prints.' })
    const btns = bar.createDiv('pmc-preview-btns')
    const close = btns.createEl('button', { text: 'Close' })
    const vault = btns.createEl('button', { text: 'Save PDF to vault' })
    const saveAs = btns.createEl('button', { text: 'Save PDF as…' })
    const print = btns.createEl('button', { text: 'Print…', cls: 'mod-cta' })
    const all = [vault, saveAs, print]
    all.forEach(b => (b.disabled = true))
    const page = this.contentEl.createDiv('pmc-preview-page')
    page.createDiv({ cls: 'pmc-muted', text: 'Rendering…' })

    close.onclick = () => this.close()
    print.onclick = async () => {
      all.forEach(b => (b.disabled = true))
      const ok = await printWithDialog(this.html)
      all.forEach(b => (b.disabled = false))
      if (ok) {
        new Notice(`Check #${this.plugin.check.checkNumber} sent to the printer.`)
        this.close()
      }
    }
    vault.onclick = async () => { if (await savePdfToVault(this.plugin, this.pdf!)) this.close() }
    saveAs.onclick = async () => {
      const p = await chooseSavePath(checkFileName(this.plugin))
      if (!p) return
      try {
        writeFile(p, this.pdf!)
        new Notice(`Saved ${p}`)
        this.close()
      } catch (e) {
        new Notice('Could not save: ' + (e as Error).message)
      }
    }
    this.scope.register(['Mod'], 'p', () => { print.click(); return false })

    try {
      this.html = currentHtml(this.plugin)
      this.pdf = await renderPdf(this.html)
      await this.showPdf(page, this.pdf)
      all.forEach(b => (b.disabled = false))
      print.focus()
    } catch (e) {
      page.empty()
      page.createDiv({ cls: 'pmc-error', text: 'Could not render the check: ' + (e as Error).message })
    }
  }

  private async showPdf (el: HTMLElement, data: Uint8Array) {
    const pdfjs = await loadPdfJs()
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise
    const p = await doc.getPage(1)
    const width = Math.min(820, (el.clientWidth || 824) - 24)
    const base = p.getViewport({ scale: 1 })
    const scale = (width / base.width) * (window.devicePixelRatio || 1)
    const vp = p.getViewport({ scale })
    const canvas = createEl('canvas')
    canvas.width = vp.width
    canvas.height = vp.height
    // Fixed display size with the page's true proportions (the canvas must
    // never be stretched or squashed by its container)
    canvas.style.width = width + 'px'
    canvas.style.height = Math.round(width * base.height / base.width) + 'px'
    await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
    el.empty()
    el.appendChild(canvas)
  }
}
