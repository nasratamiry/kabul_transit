import { Building2, ChevronDown, LogOut, Menu, Moon, Sun, UserCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/stores/theme';

import { LanguageSwitcher } from './LanguageSwitcher';

const iconButton =
  'rounded-lg p-2 text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-gray-300 dark:hover:bg-gray-700';

export function Topbar({ onMenu }: { onMenu(): void }): JSX.Element {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-20 print:hidden flex h-16 items-center gap-3 border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        onClick={onMenu}
        aria-label={t('nav.menu')}
        className={cn(iconButton, 'lg:hidden')}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Logo sits at the reading start: right in RTL, left in LTR. */}
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-bold text-white">
          K
        </span>
        <span className="hidden text-lg font-bold text-brand sm:inline dark:text-emerald-300">
          {t('app.name')}
        </span>
      </div>

      <div className="ms-2 hidden items-center gap-1.5 text-sm text-gray-600 md:flex dark:text-gray-300">
        <Building2 className="h-4 w-4" />
        <span data-testid="topbar-branch">
          {user?.role === 'super_admin' ? t('layout.all_branches') : (user?.branch_name ?? '—')}
        </span>
      </div>

      <div className="ms-auto flex items-center gap-2">
        <LanguageSwitcher />
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === 'dark' ? t('common.theme_light') : t('common.theme_dark')}
          title={theme === 'dark' ? t('common.theme_light') : t('common.theme_dark')}
          data-testid="theme-toggle"
          className={iconButton}
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

function UserMenu(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!user) return null;

  async function handleLogout(): Promise<void> {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${user.full_name} — ${t('common.user_menu')}`}
        data-testid="user-menu"
        className={cn(iconButton, 'flex items-center gap-1.5')}
      >
        <UserCircle className="h-6 w-6" />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {user.full_name}
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 mt-2 w-60 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="border-b border-gray-100 px-3 pb-3 pt-1 dark:border-gray-700">
            <p className="truncate font-medium">{user.full_name}</p>
            <p className="truncate text-xs text-gray-500" dir="ltr">
              @{user.username}
            </p>
            <Badge tone={user.role === 'super_admin' ? 'brand' : 'accent'} className="mt-2">
              {t(`roles.${user.role}`)}
            </Badge>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            data-testid="logout"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            <LogOut className="h-4 w-4 rtl:rotate-180" />
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
