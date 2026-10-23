import { Pencil } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import { cn } from '@/lib/cn';
import { normalizeNumber } from '@/lib/digits';

interface InlineEditProps {
  value: string;
  /** Called on blur / Enter when the value changed. Reject (throw) to keep editing. */
  onSave(value: string): Promise<unknown>;
  label: string;
  numeric?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
  /** What to show (e.g. Dari digits); defaults to the value. */
  display?: string;
  className?: string;
}

/**
 * Click (or Enter) → input; blur or Enter saves, Esc cancels. While saving the input
 * stays disabled; if the save fails it reopens with the typed text.
 */
export function InlineEdit({
  value,
  onSave,
  label,
  numeric = false,
  dir,
  display,
  className,
}: InlineEditProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  function start(): void {
    setDraft(value);
    setEditing(true);
  }

  async function commit(): Promise<void> {
    const next = numeric ? normalizeNumber(draft) : draft.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setDraft(next); // keep what was typed; the error toast explains why
    } finally {
      setSaving(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={draft}
        disabled={saving}
        inputMode={numeric ? 'numeric' : undefined}
        dir={numeric ? 'ltr' : dir}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        data-testid="inline-input"
        className={cn(
          'h-8 w-full min-w-[6rem] rounded-md border border-brand bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60 dark:bg-gray-900',
          numeric && 'w-20 text-end tabular-nums',
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        start();
      }}
      aria-label={`${label}: ${display ?? value}`}
      dir={dir}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-start hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-brand/20',
        className,
      )}
    >
      <span className="truncate">{(display ?? value) || '—'}</span>
      <Pencil className="h-3 w-3 shrink-0 text-gray-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
