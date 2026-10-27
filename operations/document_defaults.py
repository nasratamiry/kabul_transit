"""
Default document types and which ones each trade type needs. Plain data (no model imports):
shared by the seed commands, the new-branch signal and the data migrations.
"""

# (code, name_fa, name_ps, name_en, number_field on Transaction or '', sort_order)
DEFAULT_DOCUMENT_TYPES = [
    ('T1', 'سند T1', 'T1 سند', 'T1 transit document', 't1_number', 10),
    ('T2', 'سند T2', 'T2 سند', 'T2 document', 't2_number', 20),
    ('CMR', 'بارنامهٔ CMR', 'CMR بارنامه', 'CMR consignment note', 'cmr_number', 30),
    ('MAFI', 'مافی', 'مافي', 'MAFI', 'mafi_number', 40),
    ('CUSTOMS_DECLARATION', 'اظهارنامهٔ گمرکی', 'ګمرکي اظهارنامه', 'Customs declaration', '', 50),
    ('TARIFF_SLIP', 'آویز تعرفهٔ بانکی', 'د بانک د تعرفې آویز', 'Bank tariff slip',
     'bank_tariff_slip_number', 60),
    ('EXIT_SLIP', 'برگهٔ خروجی', 'د وتلو پاڼه', 'Exit slip', 'exit_slip_number', 70),
    ('SCALE_TICKET', 'تکت ترازو', 'د ترازو ټکټ', 'Scale ticket', 'scale_ticket_number', 80),
    ('INVOICE', 'انوایس تجارتی', 'سوداګریز انوایس', 'Commercial invoice', '', 90),
    ('PACKING_LIST', 'لست بسته‌بندی', 'د بسته‌بندۍ لست', 'Packing list', '', 100),
    ('CERT_ORIGIN', 'تصدیق مبدأ', 'د مبدأ تصدیق', 'Certificate of origin', '', 110),
    ('OTHER', 'سایر اسناد', 'نور اسناد', 'Other', '', 900),
]

# Existing uploads (before document types) are moved to this type.
FALLBACK_TYPE = 'OTHER'

# trade_type → document type codes required by default (the owner can change it per branch).
DEFAULT_REQUIREMENTS = {
    'TRANSIT': ['T1'],
    'EXPORT': ['CUSTOMS_DECLARATION', 'EXIT_SLIP'],
    'IMPORT': ['CUSTOMS_DECLARATION', 'TARIFF_SLIP'],
    'TIR_CARNET': ['CMR'],
}
