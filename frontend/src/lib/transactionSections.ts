/**
 * The 43 editable Transaction fields (operations/models.py, FIELD_SPEC in
 * config/management/commands/seed_field_config.py): which section each belongs to and how
 * it is edited. This is the single source of truth for rendering the transaction form;
 * /api/form-config/ only decides which fields are shown, required, and in what order.
 * Labels live in i18n under `form.<field>`.
 */

export type FieldType =
  | 'money' // DecimalField(14, 2) — customer_payment, customer_balance, the 13 expenses
  | 'decimal' // DecimalField(14, 2) that is not money — weight, scale_weight
  | 'integer' // PositiveIntegerField — quantity
  | 'rate' // DecimalField(14, 8) — exchange_rate
  | 'date' // jDateField (Shamsi)
  | 'fk' // trader, transport_company
  | 'choice' // status, currency
  | 'boolean' // motabari
  | 'textarea' // remarks
  | 'text';

/** react-query key prefix for every transaction query. */
export const TX_KEY = ['transactions'] as const;

export const TRADE_TYPES = ['IMPORT', 'EXPORT', 'TRANSIT', 'TIR_CARNET'] as const;
export type TradeType = (typeof TRADE_TYPES)[number];

/** Every amount deducted from customer_payment (Transaction.EXPENSE_FIELDS, same order). */
export const EXPENSE_FIELDS = [
  'khak_puli_cash',
  'khak_puli_bank',
  'revenue_estras', // named «عواید» but an EXPENSE: the only revenue is customer_payment
  'revenue_transport', // idem
  't2_delivery_expense',
  'transit_right',
  'tariff_expense',
  'expense_labor',
  'demurrage_internal',
  'demurrage_truck',
  'seal_expense',
  'scale_ticket_expense',
  'gate_ticket_expense',
] as const;

export interface Section {
  key: string;
  fields: readonly string[];
}

export const SECTIONS: Section[] = [
  { key: 'identity', fields: ['serial_number', 'date', 'status', 'motabari'] },
  { key: 'parties', fields: ['trader', 'transport_company', 'driver_name', 'driver_phone'] },
  {
    key: 'vehicle',
    fields: [
      'plate_afghan',
      'plate_foreign',
      'truck_type',
      'goods_type',
      'weight',
      'quantity',
      'scale_weight',
    ],
  },
  {
    key: 'documents',
    fields: [
      'customs_origin',
      'customs_destination',
      'bank_tariff_slip_number',
      't1_number',
      't2_number',
      'cmr_number',
      'mafi_number',
      'exit_slip_number',
      'scale_ticket_number',
      'seal_number',
    ],
  },
  // The one revenue field, its currency and the informational previous balance.
  { key: 'payment', fields: ['customer_payment', 'currency', 'exchange_rate', 'customer_balance'] },
  { key: 'expenses', fields: EXPENSE_FIELDS },
  { key: 'notes', fields: ['remarks'] },
];

const typed = (fields: readonly string[], type: FieldType): [string, FieldType][] =>
  fields.map((f) => [f, type]);

export const FIELD_TYPES: Record<string, FieldType> = {
  ...Object.fromEntries(
    typed(['customer_payment', 'customer_balance', ...EXPENSE_FIELDS], 'money'),
  ),
  ...Object.fromEntries(typed(['weight', 'scale_weight'], 'decimal')),
  quantity: 'integer',
  exchange_rate: 'rate',
  date: 'date',
  trader: 'fk',
  transport_company: 'fk',
  status: 'choice',
  currency: 'choice',
  motabari: 'boolean',
  remarks: 'textarea',
  ...Object.fromEntries(
    typed(
      [
        'serial_number',
        'driver_name',
        'driver_phone',
        'plate_afghan',
        'plate_foreign',
        'truck_type',
        'goods_type',
        'customs_origin',
        'customs_destination',
        'bank_tariff_slip_number',
        't1_number',
        't2_number',
        'cmr_number',
        'mafi_number',
        'exit_slip_number',
        'scale_ticket_number',
        'seal_number',
      ],
      'text',
    ),
  ),
};

/** Max lengths of the CharFields (the API sanitizer also caps free text at 2000). */
export const MAX_LENGTH: Record<string, number> = {
  serial_number: 50,
  plate_afghan: 40,
  plate_foreign: 40,
  driver_phone: 40,
  truck_type: 60,
  driver_name: 120,
  goods_type: 120,
  customs_origin: 120,
  customs_destination: 120,
  bank_tariff_slip_number: 60,
  t1_number: 60,
  t2_number: 60,
  cmr_number: 60,
  mafi_number: 60,
  exit_slip_number: 60,
  scale_ticket_number: 60,
  seal_number: 60,
  remarks: 2000,
};

/** FK fields → the partner endpoint and the i18n namespace of its page. */
export const FK_TARGETS: Record<string, { endpoint: string; ns: string; base: string }> = {
  trader: { endpoint: '/traders/', ns: 'traders', base: '/partners/traders' },
  transport_company: {
    endpoint: '/transport-companies/',
    ns: 'transport_companies',
    base: '/partners/transport-companies',
  },
};

export const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
