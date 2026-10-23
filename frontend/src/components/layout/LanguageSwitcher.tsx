import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LANGUAGES } from '@/i18n';
import { cn } from '@/lib/cn';

export function LanguageSwitcher({ className }: { className?: string }): JSX.Element {
  const { t, i18n } = useTranslation();
  return (
    <label className={cn('relative inline-flex items-center', className)}>
      <span className="sr-only">{t('common.language')}</span>
      <Languages className="pointer-events-none absolute start-2.5 h-4 w-4 text-gray-500" />
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className={cn(
          'h-9 appearance-none rounded-lg border border-gray-300 bg-white pe-3 ps-8 text-sm',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
        )}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
