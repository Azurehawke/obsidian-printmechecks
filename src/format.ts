import { Entry, parseAmount, parseDate } from './register'

export function money (v: string | number) {
  const n = parseAmount(v)
  return '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function totalOf (entries: Entry[]) {
  return entries.filter(e => e.status !== 'Void').reduce((s, e) => s + (parseAmount(e.amount) ?? 0), 0)
}

export function dateValue (e: Entry) {
  return parseDate(e.date)?.getTime() ?? 0
}

// Newest first: by check date, then by when it was saved
export function newestFirst (a: Entry, b: Entry) {
  return dateValue(b) - dateValue(a) || (b.savedAt || '').localeCompare(a.savedAt || '')
}

export function statusClass (s: string) {
  return 'pmc-status-' + (s || 'Issued').toLowerCase()
}
