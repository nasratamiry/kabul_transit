import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/cn';

interface TileProps {
  to: string;
  icon: LucideIcon;
  label: string;
  value: string | null;
  tone?: 'default' | 'ok' | 'bad';
  testId: string;
}

export function Tile({
  to,
  icon: Icon,
  label,
  value,
  tone = 'default',
  testId,
}: TileProps): JSX.Element {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-gray-700 dark:bg-gray-800"
    >
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          tone === 'ok' &&
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
          tone === 'bad' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
          tone === 'default' && 'bg-brand-light text-brand dark:bg-brand/30 dark:text-emerald-200',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-gray-500 dark:text-gray-400">{label}</span>
        {value === null ? (
          <span className="mt-1 block h-6 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        ) : (
          <span className="block text-xl font-bold" data-testid={`${testId}-value`}>
            {value}
          </span>
        )}
      </span>
    </Link>
  );
}
