from decimal import Decimal

from rest_framework import serializers

from finance.models import (ExchangeRate, Hawala, OfficeExpense, OfficeIncome, OfficeIncomeCategory,
                            StatementLine, statement_source_choices)

from .base import KabulModelSerializer, free_code


class ExchangeRateSerializer(KabulModelSerializer):
    class Meta:
        model = ExchangeRate
        fields = ('id', 'date', 'currency', 'rate', 'created_by', 'created_at')
        read_only_fields = ('created_by', 'created_at')


class HawalaSerializer(KabulModelSerializer):
    """`rate_used` is a snapshot taken at save time: later rate changes never alter this record."""
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, default=None)
    amount_afn = serializers.SerializerMethodField(label='معادل افغانی مبلغ')
    fee_afn = serializers.SerializerMethodField(label='معادل افغانی مصرف')

    class Meta:
        model = Hawala
        fields = '__all__'
        read_only_fields = ('rate_used', 'created_by', 'created_at', 'updated_at')

    def _afn(self, obj, value):
        if obj.currency == 'AFN':
            return str(value)
        return None if obj.rate_used is None else str((value * obj.rate_used).quantize(Decimal('0.01')))

    def get_amount_afn(self, obj):
        return self._afn(obj, obj.amount)

    def get_fee_afn(self, obj):
        return self._afn(obj, obj.fee)


class OfficeExpenseSerializer(KabulModelSerializer):
    amount_afn = serializers.SerializerMethodField(label='معادل افغانی')
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, default=None)

    class Meta:
        model = OfficeExpense
        fields = '__all__'
        read_only_fields = ('rate_used', 'created_by', 'created_at', 'updated_at')
        digit_fields = ('bill_number',)

    def get_amount_afn(self, obj):
        value = obj.amount_afn
        return None if value is None else str(value)


class OfficeIncomeCategorySerializer(KabulModelSerializer):
    """`code` is fixed once saved. incomes_count: how many office incomes use it (delete needs 0)."""
    incomes_count = serializers.IntegerField(read_only=True, default=0, label='تعداد عواید')

    class Meta:
        model = OfficeIncomeCategory
        fields = ('id', 'code', 'name_fa', 'name_ps', 'name_en', 'sort_order', 'is_active', 'incomes_count')
        extra_kwargs = {'code': {'required': False}}

    def to_internal_value(self, data):
        if isinstance(data.get('code'), str):
            data = {**data, 'code': data['code'].strip().upper()}
        return super().to_internal_value(data)

    def validate_code(self, value):
        if self.instance is not None and value != self.instance.code:
            raise serializers.ValidationError('کود بعد از ثبت تغییر کرده نمی‌تواند.')
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get('code'):
            attrs['code'] = free_code(OfficeIncomeCategory, attrs.get('name_en') or '', 'INCOME')
        return super().validate(attrs)


class OfficeIncomeSerializer(KabulModelSerializer):
    """Like an office expense: `rate_used` is the day's rate, snapshotted at save time."""
    amount_afn = serializers.SerializerMethodField(label='معادل افغانی')
    category = serializers.SlugRelatedField(slug_field='code', queryset=OfficeIncomeCategory.objects.all(),
                                            label='کتگوری')
    category_names = serializers.SerializerMethodField(label='نام کتگوری')
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True, default=None)

    class Meta:
        model = OfficeIncome
        fields = '__all__'
        read_only_fields = ('rate_used', 'created_by', 'created_at', 'updated_at')
        digit_fields = ('reference_number',)

    def get_amount_afn(self, obj):
        value = obj.amount_afn
        return None if value is None else str(value)

    def get_category_names(self, obj):
        return obj.category.names()


class StatementLineSerializer(KabulModelSerializer):
    """Income-statement line. The model's clean() rules run on every write (via KabulModelSerializer)."""
    source_field = serializers.ChoiceField(label='منبع مبلغ', choices=[])

    class Meta:
        model = StatementLine
        fields = ('id', 'section', 'code', 'label_fa', 'label_en', 'source_field', 'sort_order', 'is_active')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Read per request: types and categories are added at run time.
        self.fields['source_field'].choices = statement_source_choices()
