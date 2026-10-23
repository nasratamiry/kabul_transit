import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { isRtlLang } from '@/lib/digits';

/** Toasts sit at the reading-start corner: top-right for fa/ps, top-left for en. */
export function Toast(): JSX.Element {
  const { i18n } = useTranslation();
  const rtl = isRtlLang(i18n.language);
  return (
    <Toaster
      position={rtl ? 'top-right' : 'top-left'}
      toastOptions={{
        duration: 5000,
        className: '!rounded-lg !text-sm !shadow-lg dark:!bg-gray-800 dark:!text-gray-100',
        style: { direction: rtl ? 'rtl' : 'ltr', fontFamily: 'inherit' },
      }}
    />
  );
}
