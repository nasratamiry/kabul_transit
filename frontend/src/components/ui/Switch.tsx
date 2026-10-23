import { cn } from '@/lib/cn';

interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
  /** Visible label next to the switch; otherwise `label` is screen-reader only. */
  showLabel?: boolean;
  id?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  showLabel = false,
  id,
  className,
}: SwitchProps): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={showLabel ? undefined : label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation(); // a switch inside a clickable row toggles, it does not open the row
        onChange(!checked);
      }}
      className={cn(
        'inline-flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-800',
        className,
      )}
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-gray-300 dark:bg-gray-600',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked
              ? 'translate-x-[1.375rem] rtl:-translate-x-[1.375rem]'
              : 'translate-x-0.5 rtl:-translate-x-0.5',
          )}
        />
      </span>
      {showLabel && <span className="text-sm">{label}</span>}
    </button>
  );
}
