from rest_framework import serializers

from finance.models import ExchangeRate, Hawala, OfficeExpense, StatementLine, statement_source_choices

from .base import KabulModelSerializer


class ExchangeRateSerializer(KabulModelSerializer):
    class Meta:
        model = ExchangeRate
        fields = ('id', 'date', 'currency', 'rate', 'created_by', 'created_at')
        read_only_fields = ('created_by', 'created_at')


class HawalaSerializer(KabulModelSerializer):
    class Meta:
        model = Hawala
        fields = '__all__'
        read_only_fields = ('rate_used', 'created_by', 'created_at', 'updated_at')


class OfficeExpenseSerializer(KabulModelSerializer):
    amount_afn = serializers.SerializerMethodField(label='معادل افغانی')

    class Meta:
        model = OfficeExpense
        fields = '__all__'
        read_only_fields = ('rate_used', 'created_by', 'created_at', 'updated_at')
        digit_fields = ('bill_number',)

    def get_amount_afn(self, obj):
        value = obj.amount_afn
        return None if value is None else str(value)


class StatementLineSerializer(KabulModelSerializer):
    """Income-statement line. The model's clean() rules run on every write (via KabulModelSerializer)."""
    source_field = serializers.ChoiceField(label='منبع مبلغ', choices=statement_source_choices())

    class Meta:
        model = StatementLine
        fields = ('id', 'section', 'code', 'label_fa', 'label_en', 'source_field', 'sort_order', 'is_active')
