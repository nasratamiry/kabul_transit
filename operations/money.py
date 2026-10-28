"""
Revenue and expenses of a transaction — the one rule behind every total in the system.

A money amount is revenue only if its MoneyFieldType is of kind REVENUE (the super admin
decides, «مدیریت → عواید و مصارف»); customer_payment is always revenue. Amounts live either in
a built-in Transaction column (customer_payment + the 13 original amounts) or, for the types
added later, in TransactionMoneyLine rows. Everything that adds up a transaction — its stored
balance, the row summary, the preview, the income statement, the dashboard and Excel — asks
this module, so they can never disagree:

    total revenue  = REVENUE columns + REVENUE lines
    total expenses = EXPENSE columns + EXPENSE lines
    balance        = total revenue − total expenses   (in the transaction's own currency)
"""
from decimal import Decimal

ZERO = Decimal('0')
REVENUE, EXPENSE = 'REVENUE', 'EXPENSE'
LOCKED_CODE = 'CUSTOMER_PAYMENT'
LINE_PREFIX = '@money:'

# The 14 built-in types, seeded by operations migration 0007 with exactly these values:
# (column, code, name_fa, name_ps, name_en, kind, section, sort_order). Kinds and sections are
# what the system always did (customer_payment the one revenue; the income statement's sections).
BUILTIN_MONEY_TYPES = [
    ('customer_payment', 'CUSTOMER_PAYMENT', 'پرداخت مشتری', 'د پیرودونکي تادیه', 'Customer payment',
     REVENUE, 'REVENUE', 10),
    ('khak_puli_cash', 'KHAK_PULI_CASH', 'خاک‌پولی نقدی', 'خاک‌پولي نغدي', 'Khak-puli (cash)', EXPENSE, 'COGS', 100),
    ('khak_puli_bank', 'KHAK_PULI_BANK', 'خاک‌پولی تحویلی بانک', 'خاک‌پولي بانکي', 'Khak-puli (bank)',
     EXPENSE, 'COGS', 110),
    ('revenue_estras', 'REVENUE_ESTRAS', 'عواید بندر والی', 'د بندر والي عواید', 'Bandar Wali', EXPENSE, 'COGS', 120),
    ('revenue_transport', 'REVENUE_TRANSPORT', 'عواید ترانسپورت', 'د ترانسپورت عواید', 'Transport',
     EXPENSE, 'COGS', 130),
    ('t2_delivery_expense', 'T2_DELIVERY_EXPENSE', 'تحویلی T2', 'T2 سپارنه', 'T2 delivery', EXPENSE, 'COGS', 140),
    ('transit_right', 'TRANSIT_RIGHT', 'حق‌العبور', 'د ترانزیټ حق', 'Transit right', EXPENSE, 'COGS', 150),
    ('tariff_expense', 'TARIFF_EXPENSE', 'مصارف تعرفه', 'د تعرفې لګښت', 'Customs tariff', EXPENSE, 'COGS', 160),
    ('expense_labor', 'EXPENSE_LABOR', 'مصرف جوالی', 'د حمالۍ لګښت', 'Loading labour', EXPENSE, 'COGS', 170),
    ('demurrage_internal', 'DEMURRAGE_INTERNAL', 'توقف داخلی', 'داخلي ځنډ', 'Demurrage (internal)',
     EXPENSE, 'OTHER', 180),
    ('demurrage_truck', 'DEMURRAGE_TRUCK', 'توقف موتر / خارجی', 'د موټر / بهرنی ځنډ', 'Demurrage (truck)',
     EXPENSE, 'OTHER', 190),
    ('seal_expense', 'SEAL_EXPENSE', 'مبلغ سیم سرغچ', 'د سیم سرغچ مبلغ', 'Seal', EXPENSE, 'COGS', 200),
    ('scale_ticket_expense', 'SCALE_TICKET_EXPENSE', 'تکت ترازو', 'د ترازو ټکټ', 'Scale ticket', EXPENSE, 'COGS', 210),
    ('gate_ticket_expense', 'GATE_TICKET_EXPENSE', 'تکت دروازه', 'د دروازې ټکټ', 'Gate ticket', EXPENSE, 'COGS', 220),
]
BUILTIN_KIND = {row[0]: row[5] for row in BUILTIN_MONEY_TYPES}


def line_source(code):
    """Statement-line / form-field key of a type that keeps its amounts in TransactionMoneyLine."""
    return f'{LINE_PREFIX}{code}'


class MoneyTypes:
    """
    One read of the MoneyFieldType table (one query), answering «is this revenue?» for every
    column and line. Lists load it once and hand it to every row (attach_money), so a page of
    transactions costs the same few queries whatever its size.
    """

    def __init__(self, types):
        self.types = sorted(types, key=lambda t: (t.sort_order, t.code))
        self.by_id = {t.pk: t for t in self.types}
        self.by_code = {t.code: t for t in self.types}
        self.by_source = {t.source: t for t in self.types}
        kinds = {t.column: t.kind for t in self.types if t.column}
        # A column without a row (not seeded yet) keeps the classification it always had.
        self.column_kind = {column: kinds.get(column, kind) for column, kind in BUILTIN_KIND.items()}

    @classmethod
    def load(cls):
        from .models import MoneyFieldType
        return cls(list(MoneyFieldType.objects.all()))

    def columns(self, kind):
        return [column for column, k in self.column_kind.items() if k == kind]

    def kind_of(self, source):
        """REVENUE / EXPENSE of a column name or '@money:<code>' source; None if unknown."""
        if source in self.column_kind:
            return self.column_kind[source]
        money_type = self.by_source.get(source)
        return money_type.kind if money_type else None

    def line_types(self):
        return [t for t in self.types if not t.column]


def transaction_totals(tx, types=None):
    """(total revenue, total expenses) of one transaction in its own currency."""
    types = types or tx.money_types()
    revenue, expense = ZERO, ZERO
    for column, kind in types.column_kind.items():
        amount = Decimal(getattr(tx, column) or 0)
        if kind == REVENUE:
            revenue += amount
        else:
            expense += amount
    for type_id, amount in tx.line_amounts().items():
        money_type = types.by_id.get(type_id)
        if money_type is None:
            continue
        if money_type.kind == REVENUE:
            revenue += amount
        else:
            expense += amount
    return revenue, expense


def attach_money(transactions, types=None):
    """
    Give every transaction of a list the type registry and its money lines (two queries for
    the whole list), so their totals, row summaries and breakdowns need no query per row.
    """
    from .models import TransactionMoneyLine
    transactions = list(transactions)
    types = types or MoneyTypes.load()
    lines = {}
    ids = [tx.pk for tx in transactions if tx.pk]
    if ids:
        for transaction_id, type_id, amount in TransactionMoneyLine.objects.filter(
                transaction_id__in=ids).values_list('transaction_id', 'field_type_id', 'amount'):
            lines.setdefault(transaction_id, {})[type_id] = amount
    for tx in transactions:
        tx._money_types = types
        tx._line_amounts = lines.get(tx.pk, {})
    return types
