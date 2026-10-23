import axios from 'axios';
import { create } from 'zustand';

import type { LoginResponse, Me, Role } from '@/types/api';

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  branch_id: number | null;
  branch_name: string | null;
}

interface AuthState {
  access: string | null;
  refresh: string | null;
  user: AuthUser | null;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  loadFromStorage(): void;
  updateAccess(newAccess: string): void;
  setUser(me: Me): void;
  clear(): void;
}

const KEYS = { access: 'kc.access', refresh: 'kc.refresh', user: 'kc.user' } as const;
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export function toAuthUser(me: Me): AuthUser {
  return {
    id: me.id,
    username: me.username,
    full_name: me.full_name || me.username,
    role: me.role,
    branch_id: me.branch?.id ?? null,
    branch_name: me.branch?.name ?? null,
  };
}

// localStorage can throw (private mode, blocked storage); auth must still work in memory.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* memory only */
  }
}

function readUser(): AuthUser | null {
  const raw = read(KEYS.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Auth uses plain axios, not the api client, so a failed login never triggers the
 * refresh-on-401 flow or the global error toast; the Login page reports errors itself.
 */
export const useAuth = create<AuthState>()((set, get) => ({
  access: null,
  refresh: null,
  user: null,

  async login(username, password) {
    const { data } = await axios.post<LoginResponse>(`${API_URL}/auth/login/`, {
      username,
      password,
    });
    const user = toAuthUser(data.user);
    write(KEYS.access, data.access);
    write(KEYS.refresh, data.refresh);
    write(KEYS.user, JSON.stringify(user));
    set({ access: data.access, refresh: data.refresh, user });
  },

  async logout() {
    const { access, refresh } = get();
    get().clear();
    if (!access) return;
    try {
      // Blacklists the refresh token server-side. Best effort: local logout already happened.
      await axios.post(
        `${API_URL}/auth/logout/`,
        { refresh },
        { headers: { Authorization: `Bearer ${access}` } },
      );
    } catch {
      /* ignore */
    }
  },

  loadFromStorage() {
    const access = read(KEYS.access);
    const refresh = read(KEYS.refresh);
    const user = readUser();
    if (refresh && user) set({ access, refresh, user });
    else get().clear();
  },

  updateAccess(newAccess) {
    write(KEYS.access, newAccess);
    set({ access: newAccess });
  },

  setUser(me) {
    const user = toAuthUser(me);
    write(KEYS.user, JSON.stringify(user));
    set({ user });
  },

  clear() {
    Object.values(KEYS).forEach((k) => write(k, null));
    set({ access: null, refresh: null, user: null });
  },
}));

export const isAuthenticated = (s: Pick<AuthState, 'refresh' | 'user'>): boolean =>
  Boolean(s.refresh && s.user);
