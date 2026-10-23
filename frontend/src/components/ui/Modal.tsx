import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { useFocusTrap } from '@/lib/useFocusTrap';

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** role="alertdialog" for confirmations. */
  alert?: boolean;
  className?: string;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/** Centered dialog: backdrop click and Esc close it, focus is trapped inside. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  alert = false,
  className,
}: ModalProps): JSX.Element | null {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, onClose);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={ref}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[90vh] w-full flex-col rounded-xl bg-white shadow-xl focus:outline-none dark:bg-gray-800',
          SIZES[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-m-1 rounded-lg p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
