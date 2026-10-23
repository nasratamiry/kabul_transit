import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';

export function NotFound(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Compass className="mb-4 h-14 w-14 text-brand dark:text-emerald-300" />
      <h1 className="mb-2 text-2xl font-bold">{t('errors.not_found_title')}</h1>
      <p className="mb-6 text-gray-600 dark:text-gray-400">{t('errors.not_found')}</p>
      <Link to="/dashboard">
        <Button>{t('errors.back_home')}</Button>
      </Link>
    </div>
  );
}
