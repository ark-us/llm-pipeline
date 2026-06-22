export type CsvTable = {
  headers: string[]
  rows: string[][]
}

export function csvFence(source: string): "'''" | '```' | null {
  const trimmed = source.trim()
  if (trimmed.startsWith("'''") && trimmed.endsWith("'''")) return "'''"
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) return '```'
  return null
}

export function unwrapCsv(source: string) {
  const trimmed = source.trim()
  const fence = csvFence(trimmed)
  if (!fence) return trimmed
  return trimmed
    .slice(fence.length, -fence.length)
    .replace(/^\s*\n/, '')
    .replace(/\n\s*$/, '')
}

export function parseCsv(source: string): CsvTable {
  source = unwrapCsv(source)
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field.trim())
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(field.trim())
      if (row.some((entry) => entry.length > 0)) records.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  row.push(field.trim())
  if (row.some((entry) => entry.length > 0)) records.push(row)

  const [headers = [], ...rows] = records
  return { headers, rows }
}

export function isCsvText(source: string) {
  const table = parseCsv(source)
  return table.headers.length > 1
    && table.rows.length > 0
    && table.rows.every((row) => row.length === table.headers.length)
}

export function isFencedCsvText(source: string) {
  return Boolean(csvFence(source)) && isCsvText(source)
}

function escapeCsvField(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function stringifyCsv(table: CsvTable) {
  return [table.headers, ...table.rows]
    .map((row) => row.map(escapeCsvField).join(','))
    .join('\n')
}

export function stringifyCsvValue(source: string, table: CsvTable) {
  const fence = csvFence(source)
  const csv = stringifyCsv(table)
  return fence ? `${fence}${csv}${fence}` : csv
}
