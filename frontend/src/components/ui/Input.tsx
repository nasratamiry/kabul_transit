import { forwardRef, type FocusEvent, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';
import { normalizeNumber } from '@/lib/digits';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Numeric inputs accept Dari/Arabic digits and the '٫' decimal separator; on blur they are
 * rewritten to English digits so what the form submits is exactly what the API parses. A real type="number" input rejects
 * ۱۲۳ before JS sees it, so numeric inputs render as type="text" with a numeric inputMode.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, onBlur, type = 'text', inputMode, ...props },
  ref,
) {
  const numeric = type === 'number' || inputMode === 'numeric' || inputMode === 'decimal';

  function handleBlur(e: FocusEvent<HTMLInputElement>): void {
    if (numeric) {
      const normalized = normalizeNumber(e.target.value);
      if (normalized !== e.target.value) {
        // Native setter + input event, so react-hook-form and controlled inputs see the change.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(e.target, normalized);
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    onBlur?.(e);
  }

  return (
    <input
      ref={ref}
      type={numeric ? 'text' : type}
      inputMode={numeric ? (inputMode ?? 'decimal') : inputMode}
      dir={numeric ? 'ltr' : undefined}
      aria-invalid={invalid || undefined}
      onBlur={handleBlur}
      className={cn(
        'block h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400',
        'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30',
        'disabled:cursor-not-allowed disabled:bg-gray-100',
        'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30',
        numeric && 'text-end tabular-nums',
        invalid && 'border-red-500 focus:border-red-500 focus:ring-red-500/30 dark:border-red-400',
        className,
      )}
      {...props}
    />
  );
});
