import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  /** First, empty option (e.g. «همه» in a filter, «انتخاب کنید» in a form). */
  placeholder?: string;
  invalid?: boolean;
}

/**
 * Styled native <select>. Native on purpose: keyboard, screen readers and mobile pickers
 * all work for free. (A searchable combobox is only worth it for long lists; none yet.)
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, invalid, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'block h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white pe-9 ps-3 text-sm text-gray-900',
          'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30',
          'disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500',
          'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:disabled:bg-gray-700',
          invalid &&
            'border-red-500 focus:border-red-500 focus:ring-red-500/30 dark:border-red-400',
          className,
        )}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </div>
  );
});
