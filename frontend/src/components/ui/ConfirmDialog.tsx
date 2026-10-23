import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

import { Button } from './Button';
import { ConfirmContext, type ConfirmOptions } from './confirm-context';
import { Modal } from './Modal';

const ICONS = {
  danger: {
    Icon: ShieldAlert,
    tone: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
  },
  warning: {
    Icon: AlertTriangle,
    tone: 'bg-orange-100 text-accent-dark dark:bg-orange-900/40 dark:text-orange-300',
  },
  info: { Icon: Info, tone: 'bg-brand-light text-brand dark:bg-brand/30 dark:text-emerald-200' },
};

/** Mount once at the app root; components then call `await useConfirm()(...)`. */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false); // a newer question cancels an unanswered one
        resolver.current = resolve;
        setOptions(opts);
      }),
    [],
  );

  function answer(ok: boolean): void {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }

  const variant = options?.variant ?? 'danger';
  const { Icon, tone } = ICONS[variant];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={options !== null}
        onClose={() => answer(false)}
        title={options?.title}
        size="sm"
        alert
        footer={
          <>
            {/* Enter on a destructive dialog should not destroy: focus starts on cancel. */}
            <Button variant="secondary" onClick={() => answer(false)} data-autofocus>
              {options?.cancelLabel ?? t('common.cancel')}
            </Button>
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onClick={() => answer(true)}
              data-testid="confirm-ok"
            >
              {options?.confirmLabel ?? t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex gap-3">
          <span
            className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', tone)}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="pt-2 text-sm text-gray-600 dark:text-gray-300">{options?.message}</div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
