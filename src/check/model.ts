// Check, account and layout types, shared by the editor, printing and storage.
// These mirror the Print Me Checks desktop app so both print identically.

export interface Account {
  id: string
  label: string
  holderName: string
  address: string
  city: string
  state: string
  zip: string
  bankName: string
  routingNumber: string
  accountNumber: string
  nextCheckNumber: string
}

export interface CheckData {
  checkNumber: string
  date: string
  payTo: string
  amount: string
  memo: string
}

export interface FieldOffset { x: number, y: number }

export interface LayoutSettings {
  fontFamily: string // '' = default
  fontSize: number // px; every field scales from it
  boldValues: boolean
  offsetX: number // whole-check shift, inches
  offsetY: number
  fieldOffsets: Record<string, FieldOffset>
  showBackground: boolean
  showOutlines: boolean
  showStub: boolean // print a check stub below the check
  showGrid: boolean // millimetre grid over the check (screen only)
  snap: boolean // snap dragged fields to the grid
  gridMm: number // grid spacing, also the snap step
  zoom: number | 'fit'
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  fontFamily: '',
  fontSize: 16,
  boldValues: true,
  offsetX: 0,
  offsetY: 0,
  fieldOffsets: {},
  showBackground: true,
  showOutlines: false,
  showStub: true,
  showGrid: false,
  snap: true,
  gridMm: 1,
  zoom: 'fit'
}

export function blankAccount (id: string): Account {
  return {
    id,
    label: '',
    holderName: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    bankName: '',
    routingNumber: '',
    accountNumber: '',
    nextCheckNumber: '100'
  }
}

export function last4 (n: string | undefined) {
  const d = String(n || '').replace(/\D/g, '')
  return d ? '••' + d.slice(-4) : ''
}

export function accountTitle (a: Account) {
  return a.label || [a.bankName, last4(a.accountNumber)].filter(Boolean).join(' ') || 'Untitled account'
}

// ABA routing number checksum (3-7-1 weighting)
export function routingLooksValid (r: string) {
  if (!/^\d{9}$/.test(r)) return false
  const d = r.split('').map(Number)
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0
}

// MICR line: digits and the E13B symbols a–d only; a dash prints as the
// MICR dash symbol (d).
export function micrCheckNumber (n: string) {
  return String(n ?? '').replace(/-/g, 'd').replace(/[^0-9d]/g, '')
}
