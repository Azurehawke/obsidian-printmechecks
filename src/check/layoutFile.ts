// Check layout files: the same format the Print Me Checks desktop app reads and
// writes. A layout holds positions and display settings only, never account
// numbers, so it is safe to share.
import { FIELDS } from './layout'
import { FieldOffset, LayoutSettings } from './model'

const LAYOUT_KEYS = [
  'fontFamily', 'fontSize', 'boldValues', 'offsetX', 'offsetY', 'fieldOffsets',
  'showBackground', 'showOutlines', 'showStub', 'showGrid', 'snap', 'gridMm'
] as const

export function layoutFileData (layout: LayoutSettings) {
  const out: Record<string, unknown> = {}
  for (const k of LAYOUT_KEYS) out[k] = JSON.parse(JSON.stringify(layout[k]))
  return { app: 'printmechecks', type: 'layout', version: 1, exportedAt: new Date().toISOString(), layout: out }
}

// Keeps only known settings with sensible values, so a hand-edited or foreign
// file can't put the layout into a state it can't draw.
export function parseLayoutFile (text: string): Partial<LayoutSettings> {
  let data: { app?: string, layout?: unknown }
  try { data = JSON.parse(text) } catch { throw new Error('That file isn\'t valid JSON.') }
  const src = data?.layout as Record<string, unknown> | undefined
  if (!data || data.app !== 'printmechecks' || !src || typeof src !== 'object') {
    throw new Error('That isn\'t a Print Me Checks layout file.')
  }
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)

  const out: Partial<LayoutSettings> = {}
  if (typeof src.fontFamily === 'string') out.fontFamily = src.fontFamily.slice(0, 200)
  const fontSize = num(src.fontSize, 8, 48)
  if (fontSize !== undefined) out.fontSize = fontSize
  const offsetX = num(src.offsetX, -10, 10)
  if (offsetX !== undefined) out.offsetX = offsetX
  const offsetY = num(src.offsetY, -10, 10)
  if (offsetY !== undefined) out.offsetY = offsetY
  for (const k of ['boldValues', 'showBackground', 'showOutlines', 'showStub', 'showGrid', 'snap'] as const) {
    const v = bool(src[k])
    if (v !== undefined) out[k] = v
  }
  if ([0.5, 1, 2.5, 5].includes(src.gridMm as number)) out.gridMm = src.gridMm as number
  if (src.fieldOffsets && typeof src.fieldOffsets === 'object') {
    const fo: Record<string, FieldOffset> = {}
    for (const [k, v] of Object.entries(src.fieldOffsets as Record<string, unknown>)) {
      const o = v as { x?: unknown, y?: unknown }
      if (k in FIELDS && typeof o?.x === 'number' && Number.isFinite(o.x) && typeof o?.y === 'number' && Number.isFinite(o.y)) {
        fo[k] = { x: o.x, y: o.y }
      }
    }
    out.fieldOffsets = fo
  }
  return out
}
