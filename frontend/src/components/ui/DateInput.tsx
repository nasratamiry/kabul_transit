import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import {
  SHAMSI_MONTHS,
  WEEKDAYS,
  shamsiMonth,
  shiftShamsi,
  toGregorian,
  toShamsiKey,
  todayShamsi,
} from '@/lib/date';
import { isRtlLang, normalizeDigits, toDariDigits } from '@/lib/digits';

export interface DateInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'max' | 'min'
> {
  invalid?: boolean;
  /** Latest selectable day in the picker (Shamsi key), e.g. todayShamsi() for rates. */
  max?: string;
  /** Show the Gregorian equivalent under the field. Default true. */
  showGregorian?: boolean;
}

/**
 * Typing mask: while the text has the mask's own shape (digits, dashes after YYYY and MM),
 * dashes are inserted for the user — '14050801' → '1405-08-01'. Anything else ('1405/8/1',
 * '1405-8-1') is left alone and tidied on blur.
 */
function mask(raw: string): string {
  const text = normalizeDigits(raw);
  const shaped =
    /^\d*$/.test(text) || /^\d{4}-\d{0,2}$/.test(text) || /^\d{4}-\d{2}-\d{0,2}$/.test(text);
  if (!shaped) return text;
  const digits = text.replace(/-/g, '').slice(0, 8);
  const tail = text.endsWith('-') && (digits.length === 4 || digits.length === 6) ? '-' : '';
  if (digits.length <= 4) return digits + tail;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}${tail}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** Set a value the way a user would, so react-hook-form register() and onChange both see it. */
function setNativeValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Shamsi date field. Shows and sends Shamsi 'YYYY-MM-DD' (English digits, what the API
 * reads). Accepts Dari/Arabic/English digits and Gregorian dates too — on blur the text is
 * rewritten to Shamsi. The Gregorian equivalent is shown under the field, and the calendar
 * button opens a keyboard-operable Shamsi month picker. Works with register() or as a
 * controlled input.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  {
    invalid,
    max,
    showGregorian = true,
    className,
    onChange,
    onBlur,
    value,
    defaultValue,
    'aria-describedby': describedBy,
    ...props
  },
  forwardedRef,
) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(String(value ?? defaultValue ?? ''));
  const [open, setOpen] = useState(false);
  const helpId = useId();
  const current = value !== undefined ? String(value) : text;
  const key = toShamsiKey(current);

  function setRefs(el: HTMLInputElement | null): void {
    inputRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
    // register() writes its value straight into the DOM through the ref; mirror it for the helper.
    if (el && value === undefined) setText((prev) => (prev === el.value ? prev : el.value));
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    const masked = mask(e.target.value);
    if (masked !== e.target.value) e.target.value = masked;
    setText(masked);
    onChange?.(e);
  }

  function handleBlur(e: FocusEvent<HTMLInputElement>): void {
    const normalized = e.target.value ? toShamsiKey(e.target.value) : null;
    if (normalized && normalized !== e.target.value) setNativeValue(e.target, normalized);
    onBlur?.(e);
  }

  function pick(day: string): void {
    setOpen(false);
    if (inputRef.current) {
      setNativeValue(inputRef.current, day);
      inputRef.current.focus();
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={setRefs}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          placeholder={isRtlLang(lang) ? '۱۴۰۵-۰۸-۰۱' : '1405-08-01'}
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [describedBy, showGregorian ? helpId : null].filter(Boolean).join(' ') || undefined
          }
          className={cn(
            // Physical sides: the text is always LTR digits aligned right, the icon always on the left.
            'block h-10 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-3 text-right text-sm tabular-nums text-gray-900 placeholder:text-gray-400',
            'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30',
            'disabled:cursor-not-allowed disabled:bg-gray-100',
            'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
            invalid &&
              'border-red-500 focus:border-red-500 focus:ring-red-500/30 dark:border-red-400',
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t('date.open_calendar')}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={props.disabled}
          data-testid="date-picker-button"
          className="absolute inset-y-0 left-0 flex w-10 items-center justify-center rounded-l-lg text-gray-500 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand dark:hover:text-emerald-300"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
      </div>
      {showGregorian && (
        <p
          id={helpId}
          className="mt-1 min-h-4 text-xs text-gray-500 dark:text-gray-400"
          data-testid="date-gregorian"
        >
          {key ? `${t('date.gregorian')}: ${toGregorian(key)}` : ''}
        </p>
      )}
      {open && (
        <ShamsiPicker
          selected={key}
          max={max}
          onPick={pick}
          onClose={() => {
            setOpen(false);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
});

interface PickerProps {
  selected: string | null;
  max?: string;
  onPick(day: string): void;
  onClose(): void;
}

function ShamsiPicker({ selected, max, onPick, onClose }: PickerProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = SHAMSI_MONTHS[i18n.language] ? i18n.language : 'fa';
  const rtl = isRtlLang(lang);
  const digits = (n: string | number): string => (rtl ? toDariDigits(n) : String(n));
  const [focused, setFocused] = useState(selected ?? max ?? todayShamsi());
  const [y = 1405, m = 1] = focused.split('-').map(Number);
  const month = shamsiMonth(y, m - 1);
  const today = todayShamsi();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Keep keyboard focus on the focused day as it moves (also across months).
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused]);

  useEffect(() => {
    function outside(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onClose]);

  const disabled = (day: string): boolean => Boolean(max && day > max);

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    const moves: Record<string, [number, 'day' | 'month']> = {
      ArrowLeft: [rtl ? 1 : -1, 'day'],
      ArrowRight: [rtl ? -1 : 1, 'day'],
      ArrowUp: [-7, 'day'],
      ArrowDown: [7, 'day'],
      PageUp: [-1, 'month'],
      PageDown: [1, 'month'],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setFocused(shiftShamsi(focused, move[0], move[1]));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // close the picker, not the drawer around it
      onClose();
    }
  }

  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={onKey}
      data-testid="date-picker"
      className="absolute end-0 z-30 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setFocused(shiftShamsi(focused, -1, 'month'))}
          aria-label={t('date.prev_month')}
          className="rounded-lg p-1.5 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-gray-700"
        >
          <PrevIcon className="h-4 w-4" />
        </button>
        <span id={titleId} className="text-sm font-semibold" aria-live="polite">
          {SHAMSI_MONTHS[lang]?.[month.month]} {digits(month.year)}
        </span>
        <button
          type="button"
          onClick={() => setFocused(shiftShamsi(focused, 1, 'month'))}
          aria-label={t('date.next_month')}
          className="rounded-lg p-1.5 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-gray-700"
        >
          <NextIcon className="h-4 w-4" />
        </button>
      </div>
      <div
        role="grid"
        aria-labelledby={titleId}
        className="grid grid-cols-7 gap-1 text-center text-xs"
      >
        <div role="row" className="contents">
          {WEEKDAYS[lang]?.map((d) => (
            <span key={d} role="columnheader" className="py-1 font-medium text-gray-500">
              {d}
            </span>
          ))}
        </div>
        <div role="row" className="contents">
          {Array.from({ length: month.offset }, (_, i) => (
            <span key={`blank-${i}`} role="gridcell" />
          ))}
          {month.days.map((day, i) => {
            const isSelected = day === selected;
            return (
              <span key={day} role="gridcell" aria-selected={isSelected}>
                <button
                  type="button"
                  data-day={day}
                  tabIndex={day === focused ? 0 : -1}
                  disabled={disabled(day)}
                  onClick={() => onPick(day)}
                  aria-label={`${digits(i + 1)} ${SHAMSI_MONTHS[lang]?.[month.month]} ${digits(month.year)}`}
                  aria-current={day === today ? 'date' : undefined}
                  className={cn(
                    'h-8 w-full rounded-lg text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                    'disabled:cursor-not-allowed disabled:opacity-30',
                    isSelected
                      ? 'bg-brand text-white'
                      : 'hover:bg-brand-light dark:hover:bg-brand/30',
                    day === today && !isSelected && 'font-bold text-brand dark:text-emerald-300',
                  )}
                >
                  {digits(i + 1)}
                </button>
              </span>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 dark:border-gray-700">
        <button
          type="button"
          onClick={() => onPick(today)}
          disabled={disabled(today)}
          className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-emerald-300 dark:hover:bg-brand/30"
        >
          {t('date.today')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-gray-700"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
