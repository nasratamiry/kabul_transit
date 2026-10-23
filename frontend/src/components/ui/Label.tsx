import type { LabelHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>): JSX.Element {
  return (
    <label
      className={cn('mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300', className)}
      {...props}
    />
  );
}
