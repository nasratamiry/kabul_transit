"""Office-income categories every installation starts with (finance migration 0004). Admin-editable after."""

# (code, name_fa, name_ps, name_en, sort_order)
DEFAULT_OFFICE_INCOME_CATEGORIES = [
    ('COMMISSION', 'کمیشن', 'کمیشن', 'Commission', 10),
    ('DOCUMENT_SERVICE', 'خدمات اسناد', 'د اسنادو خدمات', 'Document services', 20),
    ('STORAGE', 'کرایهٔ گدام / پارکینگ', 'د ګدام / پارکینګ کرایه', 'Storage / parking rent', 30),
    ('EXCHANGE_GAIN', 'مفاد تبادلهٔ اسعار', 'د اسعارو د تبادلې ګټه', 'Currency exchange gain', 40),
    ('OTHER', 'سایر عواید دفتر', 'د دفتر نور عواید', 'Other office income', 90),
]
