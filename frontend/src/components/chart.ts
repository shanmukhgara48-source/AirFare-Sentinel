// Shared Recharts styling — command-center analytics visual family.

export const axisProps = {
  stroke: '#8ca0b5',
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: '#dde3ec' },
  tick: { fill: '#8ca0b5' },
} as const

export const gridProps = {
  stroke: '#e8ecf2',
  vertical: false,
} as const

export const tooltipProps = {
  contentStyle: {
    borderRadius: 6,
    border: '1px solid #d0dae8',
    fontSize: 12,
    fontFamily: "'IBM Plex Sans', sans-serif",
    boxShadow: '0 6px 20px rgba(15,27,42,0.10)',
    background: '#ffffff',
    padding: '8px 12px',
  },
  labelStyle: { color: '#5a6b80', fontSize: 11, marginBottom: 4, fontWeight: 600 },
  itemStyle: { color: '#0f1b2a', fontVariantNumeric: 'tabular-nums' },
  cursor: { fill: 'rgba(11,110,110,0.04)' },
} as const

// Aviation-analytics palette: petrol, amber, navy, teal, green, red
export const SERIES_COLORS = ['#0b6e6e', '#b45309', '#1e40af', '#0891b2', '#15803d', '#c2410c']
