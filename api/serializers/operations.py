from rest_framework import serializers

from operations.models import Document, Transaction

from .base import KabulModelSerializer


def _decimal_str(value):
    return None if value is None else str(value)


class TransactionSerializer(KabulModelSerializer):
    """
    One truck / registration. `date` is a Shamsi 'YYYY-MM-DD' string.
    Traders and transport companies are shared across branches, so their
    branch is not checked.
    """
    trader_name = serializers.CharField(source='trader.name', read_only=True, default=None)
    transport_company_name = serializers.CharField(source='transport_company.name', read_only=True, default=None)
    row_summary = serializers.SerializerMethodField(label='خلاصهٔ ردیف')
    documents_count = serializers.SerializerMethodField(label='تعداد اسناد')

    class Meta:
        model = Transaction
        fields = '__all__'
        read_only_fields = ('balance', 'created_by', 'created_at', 'updated_at')
        digit_fields = (
            'serial_number', 't1_number', 't2_number', 'cmr_number', 'mafi_number', 'exit_slip_number',
            'plate_afghan', 'plate_foreign', 'driver_phone', 'bank_tariff_slip_number',
            'scale_ticket_number', 'seal_number',
        )

    def get_row_summary(self, obj):
        # USD figures are None when fee_per_dollar_afn is unknown (see the model).
        return {
            'total_expense_afn': _decimal_str(obj.total_expense_afn),
            'fee_per_dollar_afn': _decimal_str(obj.fee_per_dollar_afn),
            'total_expense_usd': _decimal_str(obj.total_expense_usd),
            'profit_or_loss_afn': _decimal_str(obj.profit_or_loss_afn),
            'profit_or_loss_usd': _decimal_str(obj.profit_or_loss_usd),
        }

    def get_documents_count(self, obj):
        # Viewsets may annotate documents_count to avoid one query per row.
        count = getattr(obj, 'documents_count', None)
        return count if count is not None else obj.documents.count()


class DocumentSerializer(KabulModelSerializer):
    class Meta:
        model = Document
        fields = ('id', 'transaction', 'file', 'title', 'uploaded_at', 'uploaded_by')
        read_only_fields = ('uploaded_at', 'uploaded_by')
