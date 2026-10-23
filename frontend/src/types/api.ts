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
  city: string;
  phone: string;
  address: string;
  is_active: boolean;
  user_count: number;
  created_at: string;
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
  /** axes lockout (too many failed logins); only filled in for a super admin. */
  is_locked: boolean;
}

/** TraderSerializer (fields='__all__'). Company-wide, not port-scoped. Name is not unique. */
export interface Trader {
  id: number;
  name: string;
  phone: string;
  company_name: string;
  national_id: string;
  address: string;
  note: string;
  is_active: boolean;
  created_at: string;
}

/** TransportCompanySerializer (fields='__all__'). Company-wide; name is unique. */
export interface TransportCompany {
  id: number;
  name: string;
  phone: string;
  country: string;
  note: string;
  is_active: boolean;
  created_at: string;
}

/** Currencies that have a daily rate (AFN is always 1 and never stored). */
export type Currency = 'USD' | 'PKR' | 'EUR' | 'IRR';

/** ExchangeRateSerializer — `date` is Shamsi 'YYYY-MM-DD', `rate` an 8-decimal string. */
export interface ExchangeRate {
  id: number;
  date: string;
  currency: Currency;
  rate: string;
  created_by: number | null;
  created_at: string;
}

export type StatementSection = 'REVENUE' | 'COGS' | 'OPEX' | 'OTHER';

/** StatementLineSerializer */
export interface StatementLine {
  id: number;
  section: StatementSection;
  code: string;
  label_fa: string;
  label_en: string;
  source_field: string;
  sort_order: number;
  is_active: boolean;
}

/** GET /api/statement-lines/{id}/history/ (newest first). */
export interface StatementLineHistory {
  history_id: number;
  /** Dari label from simple-history: «ایجاد شد» / «تغییر کرد» / «حذف شد». */
  type: string;
  /** Backend dual_date(): 'Shamsi | Gregorian' text. */
  date: string;
  user: string | null;
  values: Omit<StatementLine, 'id'>;
}

/** DRF OPTIONS metadata (SimpleMetadata); only what the UI reads. */
export interface Choice {
  value: string;
  display_name: string;
}

export interface FieldMeta {
  type: string;
  required: boolean;
  read_only: boolean;
  label: string;
  choices?: Choice[];
}

export interface OptionsMeta {
  actions?: { POST?: Record<string, FieldMeta> };
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
