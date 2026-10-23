import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also shown as the tooltip. */
  label: string;
  tone?: 'default' | 'danger' | 'brand';
}

const TONES = {
  default:
    'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100',
  danger:
    'text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/30 dark:hover:text-red-400',
  brand: 'text-brand hover:bg-brand-light dark:text-emerald-300 dark:hover:bg-brand/30',
};

/** Small icon-only button for row actions. Clicks never reach the row underneath. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'default', className, onClick, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
