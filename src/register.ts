// Read and write the Print Me Checks register (.xlsx).
//
// Same format as the desktop app (see the app's README): one sheet named
// "Register", a header row, one row per check. Columns are matched by header
// text, so users can reorder columns, add their own, and format freely.
// Works on file contents (ArrayBuffer), so it runs on desktop and mobile.
import type * as ExcelTypes from 'exceljs'
// The browser build: no Node APIs needed (works in Obsidian mobile).
// @ts-ignore - no types for the dist file; typed via the cast below
import ExcelJSBrowser from 'exceljs/dist/exceljs.min.js'

const ExcelJS = ExcelJSBrowser as typeof ExcelTypes
type Workbook = ExcelTypes.Workbook
type Worksheet = ExcelTypes.Worksheet

export type CheckStatus = 'Issued' | 'Cleared' | 'Void'
export const STATUSES: CheckStatus[] = ['Issued', 'Cleared', 'Void']

export interface Entry {
  id: string
  row?: number
  date: string // M/D/YYYY
  checkNumber: string
  payTo: string
  amount: string // "1250.50"
  memo: string
  status: string
  accountLabel: string
  bankName: string
  accountLast4: string
  savedAt: string // ISO
  accountId: string
}

const SHEET = 'Register'

interface ColumnDef { key: keyof Entry, header: string, width: number, numFmt?: string, hidden?: boolean }

export const COLUMNS: ColumnDef[] = [
  { key: 'date', header: 'Date', width: 12, numFmt: 'm/d/yyyy' },
  { key: 'checkNumber', header: 'Check #', width: 12 },
  { key: 'payTo', header: 'Payee', width: 30 },
  { key: 'amount', header: 'Amount', width: 13, numFmt: '"$"#,##0.00' },
  { key: 'memo', header: 'Memo', width: 30 },
  { key: 'status', header: 'Status', width: 10 },
  { key: 'accountLabel', header: 'Account', width: 24 },
  { key: 'bankName', header: 'Bank', width: 22 },
  { key: 'accountLast4', header: 'Acct (last 4)', width: 12 },
  { key: 'savedAt', header: 'Saved', width: 17, numFmt: 'yyyy-mm-dd hh:mm' },
  { key: 'id', header: 'Entry ID', width: 14, hidden: true },
  { key: 'accountId', header: 'Account ID', width: 14, hidden: true }
]

// ---------- Check numbers (same rules as the app) ----------
// The last run of digits counts up and keeps its zero padding:
// 100-0001 -> 100-0002, 0099 -> 0100, 100 -> 101.
function splitNumber (n: string) {
  const m = String(n ?? '').match(/^(.*?)(\d+)(\D*)$/)
  return m ? { prefix: m[1], digits: m[2], suffix: m[3] } : null
}

export function nextCheckNumber (n: string) {
  const p = splitNumber(n)
  if (!p) return n ? n + '-1' : '100'
  return p.prefix + String(BigInt(p.digits) + 1n).padStart(p.digits.length, '0') + p.suffix
}

// Order two check numbers in the same series (null if different formats)
export function compareCheckNumbers (a: string, b: string): number | null {
  const pa = splitNumber(a)
  const pb = splitNumber(b)
  if (!pa || !pb || pa.prefix !== pb.prefix || pa.suffix !== pb.suffix) return null
  const x = BigInt(pa.digits)
  const y = BigInt(pb.digits)
  return x === y ? 0 : x > y ? 1 : -1
}

// ---------- Values ----------

export function newId () {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function todayString () {
  const d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

// "11/6/2026" or "2026-11-06" -> Date at UTC midnight (never shifts a day)
export function parseDate (s: string): Date | null {
  const t = String(s || '').trim()
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]))
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return null
}

function fromExcelDate (v: unknown) {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`
  return v == null ? '' : String(v)
}

export function parseAmount (s: string | number): number | null {
  const n = parseFloat(String(s ?? '').replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

function cellText (v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map(t => t.text).join('')
    if ('result' in o) return cellText(o.result)
    if ('text' in o) return String(o.text)
    if ('hyperlink' in o) return String(o.hyperlink)
    return ''
  }
  return String(v)
}

function toCellValues (e: Partial<Entry>): Record<string, unknown> {
  return {
    date: parseDate(e.date || '') ?? (e.date || null),
    checkNumber: e.checkNumber ?? '',
    payTo: e.payTo ?? '',
    amount: parseAmount(e.amount ?? ''),
    memo: e.memo ?? '',
    status: e.status || 'Issued',
    accountLabel: e.accountLabel ?? '',
    bankName: e.bankName ?? '',
    accountLast4: e.accountLast4 ?? '',
    savedAt: e.savedAt ? new Date(e.savedAt) : new Date(),
    id: e.id || newId(),
    accountId: e.accountId ?? ''
  }
}

// ---------- Sheet helpers ----------

type HeaderMap = Partial<Record<keyof Entry, number>>

function headerMap (ws: Worksheet): HeaderMap {
  const map: HeaderMap = {}
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const text = cellText(cell.value).trim().toLowerCase()
    const def = COLUMNS.find(c => c.header.toLowerCase() === text)
    if (def && !map[def.key]) map[def.key] = col
  })
  return map
}

function lastDataRow (ws: Worksheet) {
  for (let r = ws.rowCount; r > 1; r--) {
    let has = false
    ws.getRow(r).eachCell({ includeEmpty: false }, c => { if (cellText(c.value).trim() !== '') has = true })
    if (has) return r
  }
  return 1
}

function colLetter (n: number) {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function refreshSheet (ws: Worksheet, map: HeaderMap) {
  const cols = Object.values(map) as number[]
  if (!cols.length) return
  if (map.status) {
    const L = colLetter(map.status)
    const dv = (ws as unknown as { dataValidations: { model: object, add: (r: string, v: object) => void } }).dataValidations
    dv.model = {}
    dv.add(`${L}2:${L}5000`, { type: 'list', allowBlank: true, formulae: [`"${STATUSES.join(',')}"`] })
  }
  const max = Math.max(...cols, ws.getRow(1).cellCount)
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, lastDataRow(ws)), column: max } }
}

function ensureColumns (ws: Worksheet): HeaderMap {
  const map = headerMap(ws)
  let next = ws.getRow(1).cellCount + 1
  for (const def of COLUMNS) {
    if (!map[def.key]) {
      ws.getRow(1).getCell(next).value = def.header
      const col = ws.getColumn(next)
      col.width = def.width
      if (def.hidden) col.hidden = true
      map[def.key] = next++
    }
  }
  return map
}

function writeRow (ws: Worksheet, map: HeaderMap, rowNum: number, e: Partial<Entry>) {
  const values = toCellValues(e)
  const row = ws.getRow(rowNum)
  for (const def of COLUMNS) {
    const cell = row.getCell(map[def.key] as number)
    cell.value = values[def.key] as ExcelTypes.CellValue
    if (def.numFmt) cell.numFmt = def.numFmt
  }
  row.commit()
}

function readRow (ws: Worksheet, map: HeaderMap, rowNum: number): Entry {
  const row = ws.getRow(rowNum)
  const get = (k: keyof Entry) => (map[k] ? row.getCell(map[k] as number).value : null)
  const amount = get('amount')
  const savedAt = get('savedAt')
  return {
    id: cellText(get('id')) || `row-${rowNum}`,
    row: rowNum,
    date: fromExcelDate(get('date')),
    checkNumber: cellText(get('checkNumber')),
    payTo: cellText(get('payTo')),
    amount: typeof amount === 'number' ? amount.toFixed(2) : cellText(amount),
    memo: cellText(get('memo')),
    status: cellText(get('status')) || 'Issued',
    accountLabel: cellText(get('accountLabel')),
    bankName: cellText(get('bankName')),
    accountLast4: cellText(get('accountLast4')),
    savedAt: savedAt instanceof Date ? savedAt.toISOString() : cellText(savedAt),
    accountId: cellText(get('accountId'))
  }
}

async function load (data: ArrayBuffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data)
  const ws = wb.getWorksheet(SHEET) || wb.worksheets[0]
  if (!ws) throw new Error('The register file has no worksheets.')
  return { wb, ws }
}

async function save (wb: Workbook): Promise<ArrayBuffer> {
  const buf = await wb.xlsx.writeBuffer()
  // writeBuffer may return a Node Buffer or a Uint8Array view
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf as ArrayBufferLike)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

function findRow (ws: Worksheet, map: HeaderMap, id: string) {
  const last = lastDataRow(ws)
  for (let r = 2; r <= last; r++) {
    const rid = map.id ? cellText(ws.getRow(r).getCell(map.id).value) : ''
    if ((rid || `row-${r}`) === id) return r
  }
  return 0
}

// ---------- Public API ----------

export async function readEntries (data: ArrayBuffer): Promise<Entry[]> {
  const { ws } = await load(data)
  const map = headerMap(ws)
  if (!map.checkNumber || !map.payTo || !map.amount) {
    throw new Error('This doesn\'t look like a check register: the first row needs "Check #", "Payee" and "Amount" headers.')
  }
  const out: Entry[] = []
  const last = lastDataRow(ws)
  for (let r = 2; r <= last; r++) {
    const e = readRow(ws, map, r)
    if (e.checkNumber || e.payTo || e.amount) out.push(e)
  }
  return out
}

export async function createRegister (entries: Partial<Entry>[] = []): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Print Me Checks'
  wb.created = new Date()
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width, hidden: !!c.hidden }))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B579A' } } })
  const map = headerMap(ws)
  entries.forEach((e, i) => writeRow(ws, map, i + 2, e))
  refreshSheet(ws, map)
  return save(wb)
}

export async function appendEntry (data: ArrayBuffer, e: Partial<Entry>): Promise<ArrayBuffer> {
  const { wb, ws } = await load(data)
  const map = ensureColumns(ws)
  writeRow(ws, map, lastDataRow(ws) + 1, e)
  refreshSheet(ws, map)
  return save(wb)
}

export async function setEntryStatus (data: ArrayBuffer, id: string, status: CheckStatus): Promise<ArrayBuffer> {
  const { wb, ws } = await load(data)
  const map = ensureColumns(ws)
  const r = findRow(ws, map, id)
  if (!r) throw new Error('That check is no longer in the register (it may have been changed elsewhere).')
  ws.getRow(r).getCell(map.status as number).value = status
  ws.getRow(r).commit()
  refreshSheet(ws, map)
  return save(wb)
}

export async function removeEntry (data: ArrayBuffer, id: string): Promise<ArrayBuffer> {
  const { wb, ws } = await load(data)
  const map = headerMap(ws)
  const r = findRow(ws, map, id)
  if (!r) throw new Error('That check is no longer in the register.')
  ws.spliceRows(r, 1)
  refreshSheet(ws, map)
  return save(wb)
}
