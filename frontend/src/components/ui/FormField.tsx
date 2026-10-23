import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

interface FieldControlProps {
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}

export interface FormFieldProps {
  label: ReactNode;
  /** Error text (or an i18n key — translated if it is one). */
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactElement<FieldControlProps>;
  className?: string;
}

/**
 * Label + required marker + control + hint + error, with the label, hint and error wired
 * to the control (id, aria-describedby, aria-invalid). One look for every form.
 */
export function FormField({
  label,
  error,
  hint,
  required = false,
  children,
  className,
}: FormFieldProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const generated = useId();
  const id = (isValidElement(children) && children.props.id) || generated;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const message = error && i18n.exists(error) ? t(error) : error;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required ? (
          <span className="ms-0.5 text-red-600" aria-hidden>
            *
          </span>
        ) : (
          <span className="ms-1 text-xs font-normal text-gray-500 dark:text-gray-400">
            ({t('common.optional')})
          </span>
        )}
      </label>
      {cloneElement(children, {
        id,
        invalid: Boolean(error),
        'aria-describedby': describedBy || undefined,
        'aria-required': required || undefined,
      })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
      )}
    </div>
  );
}
