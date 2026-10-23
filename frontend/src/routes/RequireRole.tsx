import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { useAuth } from '@/stores/auth';
import type { Role } from '@/types/api';

interface RequireRoleProps {
  roles: Role[];
  children: ReactNode;
}

/** Renders a 403 page when the user's role is not in `roles`. Use inside <RequireAuth>. */
export function RequireRole({ roles, children }: RequireRoleProps): JSX.Element {
  const role = useAuth((s) => s.user?.role);
  const { t } = useTranslation();
  if (role && roles.includes(role)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-accent" />
      <h1 className="mb-2 text-xl font-semibold">{t('errors.forbidden_title')}</h1>
      <p className="mb-6 text-gray-600 dark:text-gray-400">{t('errors.forbidden')}</p>
      <Link to="/dashboard">
        <Button variant="secondary">{t('errors.back_home')}</Button>
      </Link>
    </div>
  );
}
