import {
  ArrowLeftRight,
  Building2,
  Coins,
  FileBarChart,
  LayoutDashboard,
  ListOrdered,
  Send,
  type LucideIcon,
  SlidersHorizontal,
  Users,
  Wallet,
  Handshake,
  Truck,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string; // no `to` = not built yet, shown greyed out
}

const MAIN: NavItem[] = [
  { label: 'nav.dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'nav.transactions', icon: ArrowLeftRight, to: '/transactions' },
  { label: 'nav.income_statement', icon: FileBarChart },
];

// Both roles; the API limits a branch manager to their own branch.
const FINANCE: NavItem[] = [
  { label: 'nav.hawala', icon: Send, to: '/finance/hawala' },
  { label: 'nav.office_expenses', icon: Wallet, to: '/finance/office-expenses' },
];

// Company-wide data: both roles read and edit it.
const PARTNERS: NavItem[] = [
  { label: 'nav.traders', icon: Handshake, to: '/partners/traders' },
  { label: 'nav.transport_companies', icon: Truck, to: '/partners/transport-companies' },
];

const ADMIN: NavItem[] = [
  { label: 'nav.branches', icon: Building2, to: '/admin/branches' },
  { label: 'nav.users', icon: Users, to: '/admin/users' },
  { label: 'nav.exchange_rates', icon: Coins, to: '/admin/exchange-rates' },
  { label: 'nav.statement_lines', icon: ListOrdered, to: '/admin/statement-lines' },
  { label: 'nav.field_config', icon: SlidersHorizontal },
];

interface SidebarProps {
  open: boolean;
  onClose(): void;
}

export function Sidebar({ open, onClose }: SidebarProps): JSX.Element {
  const { t } = useTranslation();
  const isSuperAdmin = useAuth((s) => s.user?.role === 'super_admin');

  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-black/40 transition-opacity lg:hidden print:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-40 flex w-64 flex-col border-e border-gray-200 bg-white transition-transform print:hidden',
          'dark:border-gray-700 dark:bg-gray-800',
          'lg:static lg:z-auto',
          // Off-canvas only below lg; the rtl:/ltr: variants would otherwise outrank lg:translate-x-0.
          !open && 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-4 lg:hidden">
          <span className="font-semibold text-brand dark:text-emerald-300">{t('nav.menu')}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('nav.close_menu')}
            className="rounded-lg p-2 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto p-3 lg:pt-5">
          <NavGroup items={MAIN} onNavigate={onClose} />
          <div data-testid="nav-finance">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('nav.finance')}
            </p>
            <NavGroup items={FINANCE} onNavigate={onClose} />
          </div>
          <div data-testid="nav-partners">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('nav.partners')}
            </p>
            <NavGroup items={PARTNERS} onNavigate={onClose} />
          </div>
          {isSuperAdmin && (
            <div data-testid="nav-admin">
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('nav.admin')}
              </p>
              <NavGroup items={ADMIN} onNavigate={onClose} />
            </div>
          )}
        </nav>
      </aside>
    </>
  );
}

function NavGroup({ items, onNavigate }: { items: NavItem[]; onNavigate(): void }): JSX.Element {
  const { t } = useTranslation();
  const base = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium';
  return (
    <ul className="space-y-1">
      {items.map(({ label, icon: Icon, to }) => (
        <li key={label}>
          {to ? (
            <NavLink
              to={to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  base,
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  isActive
                    ? 'bg-brand-light text-brand dark:bg-brand/30 dark:text-emerald-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {t(label)}
            </NavLink>
          ) : (
            <span
              aria-disabled
              className={cn(base, 'cursor-not-allowed text-gray-400 dark:text-gray-500')}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="flex-1">{t(label)}</span>
              <Badge className="text-[10px]">{t('nav.coming_soon')}</Badge>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
