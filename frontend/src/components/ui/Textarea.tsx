import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30',
        'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
        invalid && 'border-red-500 focus:border-red-500 focus:ring-red-500/30 dark:border-red-400',
        className,
      )}
      {...props}
    />
  );
});
