// Renders the check as HTML. The same markup and CSS are used on screen (in
// the editor) and in the print document, and match the desktop app, so a
// check printed from Obsidian lands in the same place on the check stock.
import { ToWords } from 'to-words'
import micrFont from '../../assets/micrenc.ttf'
import checkBackground from '../../assets/checkbg.png'
import { Account, CheckData, LayoutSettings, micrCheckNumber } from './model'
import { FIELDS, PX_PER_INCH } from './layout'

// The desktop app's default font (Bootstrap's system font stack)
export const DEFAULT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif'

const toWordsTool = new ToWords({
  localeCode: 'en-US',
  converterOptions: { currency: true, ignoreDecimal: false, ignoreZeroCurrency: false, doNotAddOnly: true }
})

export function amountNumber (v: string | number) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? null : n
}

export function amountInWords (v: string | number) {
  const n = amountNumber(v)
  if (n === null) return ''
  try { return toWordsTool.convert(n) } catch { return '' }
}

export function formatMoney (v: string | number) {
  const n = amountNumber(v) ?? 0
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function esc (s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function capitalizeWords (s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

export interface RenderOptions {
  selected?: string | null
  forPrint?: boolean
}

// The check's inner markup (fields inside .pmc-check-box)
export function checkHtml (account: Account, check: CheckData, layout: LayoutSettings, opts: RenderOptions = {}) {
  const fld = (key: string, cls: string, inner: string) => {
    const base = FIELDS[key]
    const off = layout.fieldOffsets[key] || { x: 0, y: 0 }
    const sel = opts.selected === key ? ' selected' : ''
    const title = opts.forPrint ? '' : ` title="${esc(base.label)}"`
    return `<div class="pmc-fld ${cls}${sel}" data-field="${key}"${title} style="position:absolute;top:${base.top + off.y}px;left:${base.left + off.x}px">${inner}</div>`
  }
  const city = [account.city, account.state].filter(Boolean).join(', ')
  const cityLine = [city, account.zip].filter(Boolean).join(' ')
  const words = amountInWords(check.amount)
  const font = layout.fontFamily ? `"${layout.fontFamily.replace(/"/g, '')}", ${DEFAULT_FONT}` : DEFAULT_FONT
  const style = [
    `top:${layout.offsetY * PX_PER_INCH}px`,
    `left:${layout.offsetX * PX_PER_INCH}px`,
    `font-family:${esc(font)}`,
    `font-size:${layout.fontSize}px`,
    `--pmc-val-weight:${layout.boldValues ? 'bold' : 'normal'}`
  ].join(';')

  return `<div class="pmc-check-text" style="${style}">` +
    fld('holderName', 'pmc-holder-name pmc-val', esc(account.holderName)) +
    fld('holderAddress', 'pmc-holder-address', `${esc(account.address)}<br>${esc(cityLine)}`) +
    fld('checkNumber', 'pmc-check-number-human pmc-val', esc(check.checkNumber)) +
    fld('dateLabel', 'pmc-date', 'Date: <span class="pmc-date-line"></span>') +
    fld('date', 'pmc-date-data pmc-val', esc(check.date)) +
    fld('payToLabel', 'pmc-pay-to', 'Pay to the <br>Order of <span class="pmc-payto-line"></span>') +
    fld('payTo', 'pmc-pay-to-data pmc-val', esc(check.payTo)) +
    fld('amountBox', 'pmc-amount-box', '') +
    fld('amount', 'pmc-amount-data pmc-val', esc(formatMoney(check.amount))) +
    fld('amountWords', 'pmc-amount-line-data', `*** ${esc(capitalizeWords(words))} ***`) +
    fld('amountLine', 'pmc-amount-line', '<span class="pmc-dollar-line"></span>') +
    fld('bankName', 'pmc-bank-name pmc-val', esc(account.bankName)) +
    fld('memoLabel', 'pmc-memo', 'Memo: <span class="pmc-memo-line"></span>') +
    fld('memo', 'pmc-memo-data pmc-val', esc(check.memo)) +
    fld('signatureLine', 'pmc-signature', '<span class="pmc-sig-line"></span>') +
    fld('micr', 'pmc-banking',
      `<span>a${esc(account.routingNumber)}a </span><span>${esc(account.accountNumber)}c</span><span class="pmc-micr-number">${esc(micrCheckNumber(check.checkNumber))}</span>`) +
    (layout.showStub ? stubHtml(check) : '') +
    '</div>'
}

// Stub lines below the check, starting just under the first perforation
// (canvas px; the check itself is 480 px tall).
const STUB_TOP = 530
function stubHtml (check: CheckData) {
  return `<div class="pmc-stub" style="position:absolute;top:${STUB_TOP}px;left:60px;white-space:nowrap;line-height:1.6;">` +
    `<div>Check No. ${esc(check.checkNumber)} &nbsp;&nbsp;&nbsp; Date: ${esc(check.date)}</div>` +
    `<div>Pay to: ${esc(check.payTo)} &nbsp;&nbsp;&nbsp; Amount: ${esc(formatMoney(check.amount))}</div>` +
    `<div>Memo: ${esc(check.memo)}</div>` +
    '</div>'
}

// Check CSS (shared by screen and print). Sizes in em scale with the font
// size; at 16px they match the desktop app exactly.
export const CHECK_CSS = `
@font-face { font-family: 'pmc-micr'; src: url(${micrFont}); }
.pmc-check-box, .pmc-check-box *, .pmc-check-box *::before, .pmc-check-box *::after { box-sizing: border-box; }
.pmc-check-box {
  position: relative; width: 1200px; height: 480px; background-color: white;
  -webkit-text-size-adjust: 100%;
}
.pmc-check-box.pmc-bg { background-image: url(${checkBackground}); background-repeat: no-repeat; background-size: 1200px auto; }
.pmc-check-text { position: relative; line-height: 1.5; color: #212529; font-weight: 400; text-align: left; }
.pmc-check-text .pmc-val { font-weight: var(--pmc-val-weight, bold); }
.pmc-holder-name, .pmc-check-number-human, .pmc-date-data, .pmc-pay-to-data, .pmc-amount-data, .pmc-bank-name { font-size: 1.25em; }
.pmc-amount-line-data { white-space: nowrap; }
.pmc-memo-data { font-size: 1.125em; white-space: nowrap; }
.pmc-date, .pmc-memo { white-space: nowrap; }
.pmc-date-line, .pmc-memo-line, .pmc-sig-line { display: inline-block; border-bottom: 1px solid black; vertical-align: baseline; }
.pmc-date-line { width: 190px; }
.pmc-memo-line { width: 262px; }
.pmc-sig-line { width: 358px; }
.pmc-amount-box { width: 225px; height: 40px; border: 1px solid #c7c7c7; background-color: white; }
.pmc-amount-box::before { content: "$"; font-size: 1.25em; margin-left: -15px; font-weight: bold; }
.pmc-dollar-line { width: 840px; display: block; border-bottom: 1px solid black; margin-left: 10px; margin-top: 20px; }
.pmc-dollar-line::after { content: "Dollars"; font-size: 1.125em; position: absolute; left: calc(100% + 17px); top: 0; white-space: nowrap; }
.pmc-payto-line { width: 776px; display: block; border-bottom: 1px solid black; margin-left: 73px; border-right: 1px solid black; height: 28px; margin-top: -32px; }
.pmc-banking { font-family: 'pmc-micr'; font-size: 37px; font-weight: normal; line-height: 1.5; white-space: nowrap; }
.pmc-banking .pmc-micr-number { margin-left: 20px; }
`

// A complete, standalone HTML page with just the check on a Letter page,
// laid out exactly like the desktop app's print output.
export function printDocument (account: Account, check: CheckData, layout: LayoutSettings) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Check ${esc(check.checkNumber)}</title><style>
${CHECK_CSS}
@page { size: letter; margin: 0; }
html, body { margin: 0; padding: 0; background: white; }
body { font-family: ${DEFAULT_FONT}; font-size: 16px; }
/* 1216px canvas printed at 816/1216 onto 8.5in (816 CSS px) */
.pmc-check-box { position: absolute; top: 0; left: 0; width: 1216px; height: auto; zoom: 0.671053; background: none; }
</style></head><body><div class="pmc-check-box">${checkHtml(account, check, layout, { forPrint: true })}</div></body></html>`
}
