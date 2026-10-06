// Generic dense data table with sticky header, optional server-driven sort,
// and single-row expansion (used for author/file/commit detail rows).

import type { ReactNode } from 'react'
import { IconChevron } from './Icons'

export interface Column<T> {
  key: string
  label: ReactNode
  /** right-aligned monospace — the default for every numeric column */
  num?: boolean
  width?: number
  render: (row: T, index: number) => ReactNode
  sortable?: boolean
  title?: string
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  expandable = false,
  expandedKey,
  renderExpanded,
  onRowClick,
  footer,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  sort?: SortState | null
  onSort?: (key: string) => void
  expandable?: boolean
  expandedKey?: string | number | null
  renderExpanded?: (row: T) => ReactNode
  onRowClick?: (row: T) => void
  footer?: ReactNode
}) {
  return (
    <div>
      <table className="dtable">
        <thead>
          <tr>
            {expandable && <th style={{ width: 24 }} />}
            {columns.map((col) => {
              const active = sort?.key === col.key
              return (
                <th
                  key={col.key}
                  className={[col.num && 'num', col.sortable && onSort && 'sortable'].filter(Boolean).join(' ')}
                  style={col.width ? { width: col.width } : undefined}
                  title={col.title}
                  onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
                >
                  {col.label}
                  {active && <span className="sortmark">{sort?.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey(row)
            const open = expandable && expandedKey !== undefined && expandedKey === key
            return [
              <tr
                key={key}
                className={[onRowClick ? 'clickable' : '', open ? 'expanded' : ''].filter(Boolean).join(' ')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {expandable && (
                  <td style={{ paddingRight: 0 }}>
                    <IconChevron open={open} />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className={col.num ? 'num' : ''}>
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>,
              open && renderExpanded ? (
                <tr className="rowdetail" key={`${key}-detail`}>
                  <td colSpan={columns.length + 1}>{renderExpanded(row)}</td>
                </tr>
              ) : null,
            ]
          })}
        </tbody>
      </table>
      {footer && <div className="tablefoot">{footer}</div>}
    </div>
  )
}

/** Sortable-header helper: cycles desc → asc → desc on repeated clicks. */
export function nextSort(current: SortState | null, key: string, defaultDir: 'asc' | 'desc' = 'desc'): SortState {
  if (current && current.key === key) {
    return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
  }
  return { key, dir: defaultDir }
}
