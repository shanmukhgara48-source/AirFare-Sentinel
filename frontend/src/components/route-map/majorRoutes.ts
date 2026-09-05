// Published capacity context, not a ranking inferred from stored fare quotes.
// Source: OAG India Aviation Market Briefing, September 2026.
export const CAPACITY_SOURCE = 'https://www.oag.com/indian-aviation-data'
export const MAJOR_ROUTE_LIMIT = 30

// OAG's ten busiest domestic corridors, in published order. The remaining
// corridors are a curated major-hub shortlist, not an official top-30 ranking.
const BUSY_CORRIDORS = [
  'BOM-DEL', 'BLR-DEL', 'BLR-BOM', 'CCU-DEL', 'DEL-HYD',
  'DEL-PNQ', 'AMD-DEL', 'BLR-PNQ', 'BOM-HYD', 'BOM-MAA',
] as const
const OTHER_MAJOR_CORRIDORS = [
  'DEL-MAA', 'BLR-HYD', 'BOM-CCU', 'BLR-CCU', 'BLR-MAA',
  'HYD-CCU', 'HYD-MAA', 'BOM-AMD', 'BLR-COK', 'CCU-GAU',
  'BOM-GOI', 'BOM-GOX', 'DEL-LKO', 'DEL-SXR', 'DEL-JAI',
  'DEL-IXC', 'DEL-VNS', 'DEL-COK', 'BOM-PNQ', 'BLR-GAU',
] as const

export function selectMajorRoutes(availableRoutes: readonly string[], limit = MAJOR_ROUTE_LIMIT): string[] {
  const available = new Set(availableRoutes)
  const selected: string[] = []
  for (const forward of [...BUSY_CORRIDORS, ...OTHER_MAJOR_CORRIDORS]) {
    const reverse = forward.split('-').reverse().join('-')
    const directions = [forward, reverse].filter(route => available.has(route) && !selected.includes(route))
    // Keep both observed directions together. Never invent a missing reverse.
    if (selected.length + directions.length <= limit) selected.push(...directions)
  }
  return selected
}

// Leading Indian carriers by OAG's September 2026 departing-seat capacity
// (domestic and international combined). Names improve the airline selector;
// this ordering does not exclude other carriers from fare calculations.
export const LEADING_AIRLINES: Record<string, string> = {
  '6E': 'IndiGo', AI: 'Air India', IX: 'Air India Express', QP: 'Akasa Air', SG: 'SpiceJet',
}
