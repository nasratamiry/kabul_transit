/** TS mirrors of the backend serializers (api/serializers/*). Keep in step with the Django side. */

export type Role = 'super_admin' | 'branch_manager';

/** BranchBriefSerializer */
export interface BranchBrief {
  id: number;
  name: string;
  code: string;
}

/** BranchSerializer */
export interface Branch {
  id: number;
  name: string;
  code: string;
  phone: string;
  user_count: number;
  [field: string]: unknown;
}

/** MeSerializer — GET /api/auth/me/ and the `user` of the login response. */
export interface Me {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  branch: BranchBrief | null;
  is_super_admin: boolean;
  is_branch_manager: boolean;
  is_active: boolean;
  last_login: string | null;
}

/** UserSerializer (password is write-only and never returned). */
export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  role: Role;
  branch: number | null;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  last_login: string | null;
  date_joined: string;
}

/** POST /api/auth/login/ */
export interface LoginResponse {
  access: string;
  refresh: string;
  user: Me;
}

/** POST /api/auth/refresh/ (ROTATE_REFRESH_TOKENS is off, so only `access` comes back). */
export interface RefreshResponse {
  access: string;
  refresh?: string;
}

/** Error codes the backend puts in `code` next to `detail`. */
export type ApiErrorCode =
  'TODAY_RATE_MISSING' | 'ACCOUNT_LOCKED' | 'TOO_MANY_LOGIN_ATTEMPTS' | 'TOO_MANY_REQUESTS';

/** DRF error body: `{detail, code}` or field → messages. */
export type ApiErrorBody = { detail?: string; code?: ApiErrorCode | string } & Record<
  string,
  unknown
>;

/** DRF PageNumberPagination envelope. */
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
