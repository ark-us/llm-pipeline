'use client'

import { useMemo, useState } from 'react'
import { parseCsv, stringifyCsvValue } from '@/lib/csv'

const PAGE_SIZE = 5

type CsvSpreadsheetProps = {
  label: string
  value: string
  onChange?: (value: string) => void
  onFocus: () => void
  pathPrefix: string
}

export default function CsvSpreadsheet({
  label,
  value,
  onChange,
  onFocus,
  pathPrefix,
}: CsvSpreadsheetProps) {
  const table = useMemo(() => parseCsv(value), [value])
  const [page, setPage] = useState(0)
  const [showSource, setShowSource] = useState(false)
  const displayedRowCount = table.rows.length + (onChange ? 1 : 0)
  const pageCount = Math.max(1, Math.ceil(displayedRowCount / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const rows = Array.from(
    { length: Math.min(PAGE_SIZE, Math.max(0, displayedRowCount - pageStart)) },
    (_, index) => table.rows[pageStart + index]
      ?? table.headers.map(() => ''),
  )

  function updateCell(rowIndex: number, columnIndex: number, nextValue: string) {
    if (!onChange) return
    const next = {
      headers: table.headers,
      rows: table.rows.map((row) => [...row]),
    }
    const absoluteIndex = safePage * PAGE_SIZE + rowIndex
    while (next.rows.length <= absoluteIndex) {
      next.rows.push(table.headers.map(() => ''))
    }
    next.rows[absoluteIndex][columnIndex] = nextValue
    onChange(stringifyCsvValue(value, next))
  }

  return (
    <div className="csv-spreadsheet" aria-label={label} onFocus={onFocus}>
      {showSource ? (
        <textarea
          className="csv-source-editor"
          aria-label={`${label} source`}
          value={value}
          readOnly={!onChange}
          onFocus={onFocus}
          onChange={(event) => onChange?.(event.target.value)}
        />
      ) : (
      <div className="csv-table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {table.headers.map((header) => <th key={header}>{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={safePage * PAGE_SIZE + rowIndex}>
                <th>{safePage * PAGE_SIZE + rowIndex + 1}</th>
                {table.headers.map((header, columnIndex) => (
                  <td key={header}>
                    <input
                      aria-label={`Row ${safePage * PAGE_SIZE + rowIndex + 1} ${header}`}
                      data-reference-path={`${pathPrefix}.${safePage * PAGE_SIZE + rowIndex + 1}.${header}`}
                      value={row[columnIndex] ?? ''}
                      readOnly={!onChange}
                      onFocus={onFocus}
                      onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div className="csv-pagination">
        <button
          type="button"
          className="csv-source-toggle"
          onClick={() => setShowSource((current) => !current)}
        >
          {showSource ? 'Table' : 'Source'}
        </button>
        <button type="button" disabled={showSource || safePage === 0} onClick={() => setPage(safePage - 1)}>
          ‹
        </button>
        <span>{safePage + 1} / {pageCount}</span>
        <button
          type="button"
          disabled={showSource || safePage === pageCount - 1}
          onClick={() => setPage(safePage + 1)}
        >
          ›
        </button>
      </div>
    </div>
  )
}
