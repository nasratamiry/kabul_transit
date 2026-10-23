import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { useFocusTrap } from '@/lib/useFocusTrap';

import { Button } from './Button';

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Renders the body as a <form>; the footer's submit button submits it. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  submitLabel?: ReactNode;
  submitting?: boolean;
  /** Replaces the default cancel + submit footer. */
  footer?: ReactNode;
}

/**
 * Side panel for forms. It slides in from the end side (the left in RTL, the right in
 * LTR), opposite the sidebar. Backdrop click and Esc close it; focus is trapped inside.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  onSubmit,
  submitLabel,
  submitting = false,
  footer,
}: DrawerProps): JSX.Element | null {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Mount → next frame → slide in. Unmount right away on close (forms reset cleanly).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(id);
      setShown(false);
    };
  }, [open]);
  useFocusTrap(ref, open, onClose);
  if (!open) return null;

  const content = (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="-m-1 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-gray-700"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
      <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-800">
        {footer ?? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            {onSubmit && (
              <Button type="submit" loading={submitting} data-testid="drawer-submit">
                {submitting ? t('common.saving') : (submitLabel ?? t('common.save'))}
              </Button>
            )}
          </>
        )}
      </footer>
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-black/40 transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 end-0 flex w-full flex-col bg-white shadow-2xl transition-transform duration-200 focus:outline-none sm:w-[480px] md:w-[560px] dark:bg-gray-800',
          !shown && 'ltr:translate-x-full rtl:-translate-x-full',
        )}
      >
        {onSubmit ? (
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            {content}
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{content}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
