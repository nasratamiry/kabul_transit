import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useMatches } from 'react-router-dom';

import { isRtlLang } from '@/lib/digits';
import type { RouteHandle } from '@/routes';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar onMenu={() => setMenuOpen(true)} />
      <div className="flex flex-1">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Breadcrumbs />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Breadcrumbs(): JSX.Element {
  const { t, i18n } = useTranslation();
  const Sep = isRtlLang(i18n.language) ? ChevronLeft : ChevronRight;
  const crumbs = useMatches()
    .map((m) => ({ path: m.pathname, crumb: (m.handle as RouteHandle | undefined)?.crumb }))
    .filter((c): c is { path: string; crumb: string } => Boolean(c.crumb));

  return (
    <nav aria-label="breadcrumb" className="mb-5 text-sm text-gray-500 dark:text-gray-400">
      <ol className="flex flex-wrap items-center gap-1.5">
        {crumbs.map((c, i) => (
          <Fragment key={c.path}>
            {i > 0 && <Sep className="h-4 w-4" aria-hidden />}
            <li>
              {i === crumbs.length - 1 ? (
                <span aria-current="page" className="font-medium text-gray-800 dark:text-gray-200">
                  {t(c.crumb)}
                </span>
              ) : (
                <Link to={c.path} className="hover:text-brand dark:hover:text-emerald-300">
                  {t(c.crumb)}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
