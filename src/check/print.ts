// Printing and PDF output on Obsidian desktop.
//
// The check is rendered as a standalone page (printDocument) in a hidden
// Electron window, exactly like the desktop app's print layout. That window
// is used to make the PDF (for the preview and Save as PDF) and to open the
// Windows print dialog. Not available on mobile.
import { Platform } from 'obsidian'

/* eslint-disable @typescript-eslint/no-explicit-any */
type WebContents = any
type BrowserWindow = any

export const canPrint = () => Platform.isDesktopApp

function remote (): any {
  // Obsidian desktop exposes Electron's remote module to plugins
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (window as any).require('electron').remote
}

function node (mod: string): any {
  return (window as any).require(mod)
}

const PRINT_OPTIONS = { pageSize: 'Letter', margins: { marginType: 'none' } }

async function openPrintWindow (html: string): Promise<{ win: BrowserWindow, cleanup: () => void }> {
  const os = node('os')
  const fs = node('fs')
  const path = node('path')
  const file = path.join(os.tmpdir(), `printmechecks-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`)
  fs.writeFileSync(file, html, 'utf8')
  const win = new (remote().BrowserWindow)({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const cleanup = () => {
    try { if (!win.isDestroyed()) win.destroy() } catch { /* already gone */ }
    try { fs.rmSync(file, { force: true }) } catch { /* ignore */ }
  }
  try {
    await win.loadFile(file)
    // Wait for the MICR font and any chosen font to finish loading
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  } catch (e) {
    cleanup()
    throw e
  }
  return { win, cleanup }
}

// PDF of the check (Uint8Array)
export async function renderPdf (html: string): Promise<Uint8Array> {
  const { win, cleanup } = await openPrintWindow(html)
  try {
    const buf = await (win.webContents as WebContents).printToPDF({ ...PRINT_OPTIONS, printBackground: false, preferCSSPageSize: true })
    return new Uint8Array(buf)
  } finally {
    cleanup()
  }
}

// Opens the Windows print dialog. Resolves true if it printed.
export async function printWithDialog (html: string): Promise<boolean> {
  const { win, cleanup } = await openPrintWindow(html)
  return new Promise(resolve => {
    try {
      (win.webContents as WebContents).print({ ...PRINT_OPTIONS, silent: false, printBackground: false }, (ok: boolean, reason: string) => {
        if (!ok && reason && reason !== 'cancelled') console.error('[Print Me Checks] print failed:', reason)
        cleanup()
        resolve(ok)
      })
    } catch (e) {
      cleanup()
      console.error('[Print Me Checks] print failed:', e)
      resolve(false)
    }
  })
}

// Save dialog outside the vault. Returns the chosen path or null.
export async function chooseSavePath (defaultName: string): Promise<string | null> {
  const r = remote()
  const docs = r.app.getPath('documents')
  const path = node('path')
  const res = await r.dialog.showSaveDialog(r.getCurrentWindow(), {
    title: 'Save check as PDF',
    defaultPath: path.join(docs, defaultName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  return res.canceled || !res.filePath ? null : res.filePath
}

export function writeFile (filePath: string, data: Uint8Array) {
  node('fs').writeFileSync(filePath, data)
}

export function safeFileName (name: string) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f#^[\]]/g, '').replace(/\s+/g, ' ').trim() || 'check'
}
