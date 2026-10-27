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

/** TransactionSerializer.row_summary — USD figures are null unless the record is in USD. */
export interface RowSummary {
  total_expense_afn: string;
  fee_per_dollar_afn: string | null;
  total_expense_usd: string | null;
  profit_or_loss_afn: string;
  profit_or_loss_usd: string | null;
}

/** TransactionSerializer (fields='__all__' + extras). Money fields are decimal strings. */
export interface Transaction {
  id: number;
  branch: number;
  trade_type: 'IMPORT' | 'EXPORT' | 'TRANSIT' | 'TIR_CARNET';
  serial_number: string;
  /** Shamsi 'YYYY-MM-DD'. */
  date: string;
  status: 'WAITING' | 'SEALED' | 'EXITED';
  motabari: boolean;
  currency: 'AFN' | 'USD' | 'PKR' | 'EUR' | 'IRR';
  exchange_rate: string;
  customer_payment: string;
  balance: string;
  trader: number | null;
  trader_name: string | null;
  transport_company: number | null;
  transport_company_name: string | null;
  plate_afghan: string;
  plate_foreign: string;
  row_summary: RowSummary;
  documents_count: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  /** The other editable fields (see lib/transactionSections.ts). */
  [field: string]: unknown;
}

/** DocumentSerializer — the file itself is only reachable through download_url (authenticated). */
export interface TxDocument {
  id: number;
  transaction: number;
  title: string;
  uploaded_at: string;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  /** '/api/documents/<id>/download/' — add ?download=1 for an attachment. */
  download_url: string;
  file_name: string;
  file_size: number | null;
  content_type: string;
}

/** GET <resource>/<id>/history/ (api/history.py) — newest first, changed fields only. */
export interface HistoryEntry {
  history_id: number;
  type: string;
  /** 'Shamsi | Gregorian' */
  date: string;
  user: string | null;
  changes: { field: string; label: string; old: string | null; new: string | null }[];
}

/** GET /api/form-config/ — hidden fields are already left out, sorted by sort_order. */
export interface FormConfig {
  branch: number;
  trade_type: Transaction['trade_type'];
  trade_type_label: string;
  form_fields: {
    field_name: string;
    label_fa: string;
    visibility: 'REQUIRED' | 'OPTIONAL';
    required: boolean;
    sort_order: number;
  }[];
}

/** POST /api/transactions/preview-summary/ */
export interface PreviewSummary {
  currency: Transaction['currency'];
  /** Shamsi date the USD figures were computed for. */
  date: string;
  customer_payment_afn: string;
  total_expense_afn: string;
  profit_or_loss_afn: string;
  fee_per_dollar_afn: string | null;
  total_expense_usd: string | null;
  profit_or_loss_usd: string | null;
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

/** finance.reports.amount_totals — afn / usd are null when some record's rate is unknown. */
export interface AmountTotals {
  by_currency: Record<string, string>;
  afn: string | null;
  usd: string | null;
  groups: Record<string, { afn: string | null; usd: string | null }>;
  unconverted: number;
}

/** A paged finance list with `totals` for the whole filtered set (not just the page). */
export interface PaginatedWithTotals<T, Totals> extends Paginated<T> {
  totals: Totals;
}

/** All currencies a hawala / office expense can be in (AFN included). */
export type AnyCurrency = 'AFN' | Currency;

/** HawalaSerializer. `rate_used` is the snapshot taken at save time (null for AFN / no rate). */
export interface Hawala {
  id: number;
  branch: number;
  date: string;
  from_party: string;
  to_party: string;
  amount: string;
  currency: AnyCurrency;
  fee: string;
  rate_used: string | null;
  amount_afn: string | null;
  fee_afn: string | null;
  note: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface HawalaTotals {
  amount: AmountTotals;
  /** The only part of a hawala that is an expense (OPEX_HAWALA_FEE). */
  fee: AmountTotals;
}

export type OfficeExpenseCategory =
  'SALARY' | 'RENT' | 'FUEL' | 'KITCHEN' | 'STATIONERY' | 'CREDIT' | 'OTHER';

/** OfficeExpenseSerializer */
export interface OfficeExpense {
  id: number;
  branch: number;
  date: string;
  category: OfficeExpenseCategory;
  amount: string;
  currency: AnyCurrency;
  rate_used: string | null;
  amount_afn: string | null;
  person: string;
  bill_number: string;
  description: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** groups = per category; salary / non_salary = OPEX_SALARY / OPEX_OFFICE of the report. */
export interface OfficeExpenseTotals extends AmountTotals {
  salary: AmountTotals;
  non_salary: AmountTotals;
}

/** Revenue / all expenses / net of a period (finance.reports._summary). */
export interface PeriodSummary {
  transactions_count: number;
  revenue_afn: string | null;
  revenue_usd: string | null;
  expenses_afn: string | null;
  expenses_usd: string | null;
  net_profit_afn: string | null;
  net_profit_usd: string | null;
}

export interface ReportPeriod {
  from: string;
  to: string;
  from_gregorian: string;
  to_gregorian: string;
}

/** GET /api/income-statement/ — amounts are 2-decimal strings, null when a rate is unknown. */
export interface IncomeStatement {
  period: ReportPeriod;
  branch: { id: number; name: string; code: string } | null;
  transactions_count: number;
  lines: {
    section: StatementSection;
    section_label: string;
    code: string;
    label_fa: string;
    label_en: string;
    source_field: string;
    amount_afn: string | null;
    amount_usd: string | null;
  }[];
  totals: Record<
    | 'revenue_afn'
    | 'revenue_usd'
    | 'cogs_afn'
    | 'cogs_usd'
    | 'gross_profit_afn'
    | 'gross_profit_usd'
    | 'opex_afn'
    | 'opex_usd'
    | 'other_afn'
    | 'other_usd'
    | 'net_profit_afn'
    | 'net_profit_usd',
    string | null
  >;
  summary: PeriodSummary;
  warnings: string[];
  /** Backend dual_date(): 'Shamsi | Gregorian'. */
  generated_at: string;
}

/** GET /api/dashboard/summary/ */
export interface DashboardSummary {
  current: PeriodSummary & { period: ReportPeriod };
  previous: PeriodSummary & { period: ReportPeriod };
  daily: {
    date: string;
    date_gregorian: string;
    net_profit_afn: string | null;
    net_profit_usd: string | null;
    transactions_count: number;
  }[];
  top_traders: {
    id: number;
    name: string;
    transactions_count: number;
    customer_payment_afn: string | null;
    customer_payment_usd: string | null;
  }[];
  recent_transactions: {
    id: number;
    serial_number: string;
    date: string;
    date_gregorian: string;
    trade_type: string;
    status: string;
    branch: string;
    trader: string | null;
    currency: string;
    customer_payment: string;
  }[];
  today_rate: { date: string; currency: 'USD'; rate: string | null; is_set: boolean };
  /** Super admin without ?branch= only: this month per branch. */
  branches?: ({
    branch: { id: number; name: string; code: string; is_active: boolean };
  } & PeriodSummary)[];
  branch: number | null;
  warnings: string[];
  generated_at: string;
}
