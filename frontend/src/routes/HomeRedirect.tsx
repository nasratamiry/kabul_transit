import { Navigate } from 'react-router';

import { useAuth } from '@/stores/auth';

/** `/` → the role's landing page. Both roles land on the dashboard until later stages. */
export function HomeRedirect(): JSX.Element {
  const role = useAuth((s) => s.user?.role);
  return <Navigate to={role ? '/dashboard' : '/login'} replace />;
}
