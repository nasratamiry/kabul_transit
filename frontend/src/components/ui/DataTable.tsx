import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Logical alignment: 'start' / 'end' follow the reading direction. Default 'start'. */
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** The header becomes a sort button (the table only reports clicks; the page sorts). */
  sortable?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  emptyMessage?: ReactNode;
  /** Extra classes for a row (e.g. greyed out when inactive). */
  rowClassName?: (row: T) => string | false | undefined;
  caption?: string;
  className?: string;
  sort?: SortState;
  /** Called with the column key; the caller decides the new direction. */
  onSort?: (key: string) => void;
}

const ALIGN = { start: 'text-start', center: 'text-center', end: 'text-end' };
// First column stays visible while the table scrolls sideways on small screens.
const STICKY = 'sticky start-0 z-[1] bg-inherit';

/**
 * Typed list table: sticky header, zebra rows, clickable rows (mouse and Enter/Space),
 * 3 skeleton rows while loading, empty state. Alignment is logical (start/end), so the same
 * table reads correctly in RTL and LTR.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isLoading = false,
  emptyMessage,
  rowClassName,
  caption,
  className,
  sort,
  onSort,
}: DataTableProps<T>): JSX.Element {
  const showSkeleton = isLoading && !rows?.length;

  function onKey(e: KeyboardEvent<HTMLTableRowElement>, row: T): void {
    if (e.target !== e.currentTarget) return; // keys inside a row's buttons are theirs
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row);
    }
  }

  return (
    <div
      className={cn(
        'relative max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        className,
      )}
    >
      <table className="w-full min-w-max border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-[2] bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          <tr>
            {columns.map((col, i) => {
              const active = sort?.key === col.key;
              const SortIcon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    col.sortable
                      ? active
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                  className={cn(
                    'whitespace-nowrap border-b border-gray-200 px-4 py-3 dark:border-gray-700',
                    ALIGN[col.align ?? 'start'],
                    i === 0 && STICKY,
                    col.className,
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      data-testid={`sort-${col.key}`}
                      className="inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:text-gray-100"
                    >
                      {col.header}
                      <SortIcon
                        className={cn('h-3.5 w-3.5', !active && 'opacity-40')}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody aria-busy={isLoading || undefined}>
          {showSkeleton &&
            [0, 1, 2].map((n) => (
              <tr
                key={`skeleton-${n}`}
                data-testid="skeleton-row"
                className="bg-white dark:bg-gray-800"
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3.5">
                    <div className="h-4 w-full max-w-[8rem] animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                  </td>
                ))}
              </tr>
            ))}
          {!showSkeleton && !rows?.length && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-14 text-center">
                <Inbox className="mx-auto mb-2 h-10 w-10 text-gray-300 dark:text-gray-600" />
                <p className="text-gray-500 dark:text-gray-400" data-testid="table-empty">
                  {emptyMessage}
                </p>
              </td>
            </tr>
          )}
          {!showSkeleton &&
            rows?.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  'border-b border-gray-100 bg-white last:border-0 even:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-800 dark:even:bg-gray-800/60',
                  onRowClick &&
                    'cursor-pointer hover:bg-brand-light/60 focus-visible:bg-brand-light focus-visible:outline-none dark:hover:bg-brand/20 dark:focus-visible:bg-brand/30',
                  rowClassName?.(row),
                )}
              >
                {columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={cn(
                      'whitespace-nowrap px-4 py-3',
                      ALIGN[col.align ?? 'start'],
                      i === 0 && STICKY,
                      col.className,
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
