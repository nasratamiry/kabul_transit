import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { isAuthenticated, useAuth } from '@/stores/auth';

/** Sends anonymous users to /login and remembers where they were going (location.state.from). */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const authed = useAuth(isAuthenticated);
  const location = useLocation();
  if (!authed) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}
