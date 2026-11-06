// Default field positions on the check, in canvas px (top-left corner).
// Identical to the desktop app. The printed page maps 1216 canvas px to
// 8.5 inches.
export const PX_PER_INCH = 1216 / 8.5
export const CHECK_WIDTH = 1200

export interface FieldDef { label: string, top: number, left: number }

export const FIELDS: Record<string, FieldDef> = {
  holderName: { label: 'Account holder name', top: 40, left: 60 },
  holderAddress: { label: 'Address', top: 70, left: 60 },
  checkNumber: { label: 'Check number', top: 40, left: 1060 },
  dateLabel: { label: 'Date line', top: 90, left: 760 },
  date: { label: 'Date', top: 80, left: 850 },
  payToLabel: { label: 'Pay to the order of (line)', top: 170, left: 60 },
  payTo: { label: 'Payee', top: 180, left: 180 },
  amountBox: { label: 'Amount box', top: 175, left: 950 },
  amount: { label: 'Amount', top: 182, left: 970 },
  amountWords: { label: 'Amount in words', top: 240, left: 100 },
  amountLine: { label: 'Dollars line', top: 250, left: 60 },
  bankName: { label: 'Bank name', top: 300, left: 60 },
  memoLabel: { label: 'Memo line', top: 390, left: 60 },
  memo: { label: 'Memo', top: 384, left: 120 },
  signatureLine: { label: 'Signature line', top: 390, left: 750 },
  micr: { label: 'MICR line (routing / account / check #)', top: 340, left: 80 }
}
