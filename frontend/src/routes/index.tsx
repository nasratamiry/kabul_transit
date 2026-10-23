import { createBrowserRouter } from 'react-router-dom';

import { AppShell } from '@/components/layout/AppShell';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { NotFound } from '@/pages/NotFound';

import { HomeRedirect } from './HomeRedirect';
import { RequireAuth } from './RequireAuth';

/** Breadcrumb label (i18n key) for a route, read by <Breadcrumbs> via useMatches(). */
export interface RouteHandle {
  crumb?: string;
}

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/not-found', element: <NotFound /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    handle: { crumb: 'nav.home' } satisfies RouteHandle,
    children: [
      { index: true, element: <HomeRedirect /> },
      {
        path: 'dashboard',
        element: <Dashboard />,
        handle: { crumb: 'nav.dashboard' } satisfies RouteHandle,
      },
      // Later stages: wrap super-admin pages in <RequireRole roles={['super_admin']}>.
    ],
  },
  { path: '*', element: <NotFound /> },
]);
