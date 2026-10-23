import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';

interface SpinnerProps {
  className?: string;
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps): JSX.Element {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('h-4 w-4 animate-spin text-current', className)}
    />
  );
}
