import { createBrowserRouter, Outlet } from 'react-router-dom';

import { AppShell } from '@/components/layout/AppShell';
import { Branches } from '@/pages/admin/Branches';
import { ExchangeRates } from '@/pages/admin/ExchangeRates';
import { StatementLines } from '@/pages/admin/StatementLines';
import { Users } from '@/pages/admin/Users';
import { Dashboard } from '@/pages/Dashboard';
import { HawalaPage } from '@/pages/finance/HawalaPage';
import { OfficeExpensesPage } from '@/pages/finance/OfficeExpensesPage';
import { Login } from '@/pages/Login';
import { Traders } from '@/pages/partners/Traders';
import { TransportCompanies } from '@/pages/partners/TransportCompanies';
import { NotFound } from '@/pages/NotFound';
import { TradeTypePicker } from '@/pages/transactions/TradeTypePicker';
import { TransactionDetail } from '@/pages/transactions/TransactionDetail';
import { TransactionForm } from '@/pages/transactions/TransactionForm';
import { TransactionsList } from '@/pages/transactions/TransactionsList';

import { HomeRedirect } from './HomeRedirect';
import { RequireAuth } from './RequireAuth';
import { RequireRole } from './RequireRole';

/** Breadcrumb label (i18n key) for a route, read by <Breadcrumbs> via useMatches(). */
export interface RouteHandle {
  crumb?: string;
  /** false: the crumb is a group label with no page of its own (e.g. «مدیریت»). */
  link?: false;
}

const crumb = (key: string, link?: false): RouteHandle => ({ crumb: key, link });

/**
 * Drawer and dialog states are child routes without elements: the list page stays mounted
 * (filters and scroll survive) and reads them with useMatch(), so every drawer has a
 * shareable URL.
 */
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
    handle: crumb('nav.home'),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: <Dashboard />, handle: crumb('nav.dashboard') },
      {
        // Both roles; a branch manager only ever sees their own branch (API queryset).
        path: 'transactions',
        handle: crumb('nav.transactions'),
        children: [
          { index: true, element: <TransactionsList /> },
          { path: 'new', element: <TradeTypePicker />, handle: crumb('common.add') },
          {
            path: 'new/:tradeType',
            element: <TransactionForm />,
            handle: crumb('common.add'),
          },
          { path: ':id', element: <TransactionDetail />, handle: crumb('detail.crumb') },
          { path: ':id/edit', element: <TransactionForm />, handle: crumb('common.edit') },
        ],
      },
      {
        // Both roles; a branch manager only ever sees their own branch (API queryset).
        path: 'finance',
        handle: crumb('nav.finance', false),
        children: [
          {
            path: 'hawala',
            element: <HawalaPage />,
            handle: crumb('nav.hawala'),
            children: [
              { path: 'new', handle: crumb('common.add') },
              { path: ':id/edit', handle: crumb('common.edit') },
              { path: ':id/history', handle: crumb('finance.history') },
            ],
          },
          {
            path: 'office-expenses',
            element: <OfficeExpensesPage />,
            handle: crumb('nav.office_expenses'),
            children: [
              { path: 'new', handle: crumb('common.add') },
              { path: ':id/edit', handle: crumb('common.edit') },
              { path: ':id/history', handle: crumb('finance.history') },
            ],
          },
        ],
      },
      {
        // Company-wide partners: both roles (no RequireRole).
        path: 'partners',
        handle: crumb('nav.partners', false),
        children: [
          {
            path: 'traders',
            element: <Traders />,
            handle: crumb('nav.traders'),
            children: [
              { path: 'new', handle: crumb('common.add') },
              { path: ':id/edit', handle: crumb('common.edit') },
            ],
          },
          {
            path: 'transport-companies',
            element: <TransportCompanies />,
            handle: crumb('nav.transport_companies'),
            children: [
              { path: 'new', handle: crumb('common.add') },
              { path: ':id/edit', handle: crumb('common.edit') },
            ],
          },
        ],
      },
      {
        path: 'admin',
        element: (
          <RequireRole roles={['super_admin']}>
            <Outlet />
          </RequireRole>
        ),
        handle: crumb('nav.admin', false),
        children: [
          {
            path: 'branches',
            element: <Branches />,
            handle: crumb('nav.branches'),
            children: [
              { path: 'new', handle: crumb('common.add') },
              { path: ':id/edit', handle: crumb('common.edit') },
            ],
          },
          {
            path: 'users',
            element: <Users />,
            handle: crumb('nav.users'),
            children: [
              { path: 'new', handle: crumb('common.add') },
              { path: ':id/edit', handle: crumb('common.edit') },
            ],
          },
          {
            path: 'exchange-rates',
            element: <ExchangeRates />,
            handle: crumb('nav.exchange_rates'),
            children: [{ path: 'new', handle: crumb('common.add') }],
          },
          {
            path: 'statement-lines',
            element: <StatementLines />,
            handle: crumb('nav.statement_lines'),
            children: [
              { path: 'new', handle: crumb('common.add') },
              { path: ':id/edit', handle: crumb('common.edit') },
              { path: ':id/history', handle: crumb('statement_lines.history_button') },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
