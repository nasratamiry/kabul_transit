import { createContext, useContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  variant?: 'danger' | 'warning' | 'info';
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/** `const ok = await confirm({ title, message, variant })` — needs <ConfirmProvider> above. */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() outside <ConfirmProvider>');
  return confirm;
}
