from rest_framework import serializers
from rest_framework.exceptions import APIException

from config.models import FieldConfig
from kabulcargo_backend.utils import normalize_digits
from operations.models import MoneyFieldType, Transaction

from .base import KabulModelSerializer, free_code


class Conflict(APIException):
    status_code = 409
    default_code = 'CONFLICT'


class MoneyFieldTypeSerializer(KabulModelSerializer):
    """
    A revenue / expense type. `code` is optional on create (made from the English name) and
    fixed afterwards. Changing `kind` is refused with 409 while any transaction holds an amount of
    the type; customer_payment can never change kind or be deactivated (model clean()).
    """
    source = serializers.CharField(read_only=True, label='کلید فیلد')
    locked = serializers.BooleanField(read_only=True, label='قفل')
    amounts_count = serializers.SerializerMethodField(label='تعداد معاملات دارای مبلغ')

    class Meta:
        model = MoneyFieldType
        fields = ('id', 'code', 'column', 'source', 'name_fa', 'name_ps', 'name_en', 'kind', 'section',
                  'sort_order', 'is_active', 'is_builtin', 'locked', 'amounts_count')
        read_only_fields = ('column', 'is_builtin')
        extra_kwargs = {'code': {'required': False}, 'section': {'required': False}}

    def to_internal_value(self, data):
        if isinstance(data.get('code'), str):
            data = {**data, 'code': data['code'].strip().upper()}
        return super().to_internal_value(data)

    def get_amounts_count(self, obj):
        counts = self.context.get('amounts_counts')
        return counts.get(obj.pk, 0) if counts is not None else None

    def validate_code(self, value):
        if self.instance is not None and value != self.instance.code:
            raise serializers.ValidationError('کود بعد از ثبت تغییر کرده نمی‌تواند.')
        return value

    def validate(self, attrs):
        instance = self.instance
        if instance is None:
            if not attrs.get('code'):
                attrs['code'] = free_code(MoneyFieldType, attrs.get('name_en') or '', 'TYPE')
            if attrs.get('kind') == MoneyFieldType.Kind.EXPENSE and not attrs.get('section'):
                attrs['section'] = MoneyFieldType.Section.COGS
        elif 'kind' in attrs and attrs['kind'] != instance.kind:
            if instance.locked:
                raise Conflict('«پرداخت مشتری» همیشه عاید است و نوعش تغییر کرده نمی‌تواند.')
            used = instance.amounts_count()
            if used:
                raise Conflict(f'نوع «{instance.name_fa}» را تغییر داده نمی‌توانید، چون {used} معامله مبلغ آن را '
                               'دارد. نوع فقط تا وقتی تغییر می‌کند که هیچ مبلغی ثبت نشده باشد.')
            if attrs['kind'] == MoneyFieldType.Kind.EXPENSE and 'section' not in attrs:
                attrs['section'] = MoneyFieldType.Section.COGS
        if attrs.get('kind', instance.kind if instance else None) == MoneyFieldType.Kind.REVENUE:
            attrs['section'] = MoneyFieldType.Section.REVENUE  # a revenue type is always in the revenue section
        return super().validate(attrs)


class _DigitsIntegerField(serializers.IntegerField):
    def to_internal_value(self, data):
        return super().to_internal_value(normalize_digits(str(data)) if isinstance(data, str) else data)


class MoneyVisibilityRowSerializer(serializers.Serializer):
    money_type = _DigitsIntegerField(label='نوع')
    visibility = serializers.ChoiceField(choices=FieldConfig.Visibility.choices, label='وضعیت')


class MoneyVisibilitySerializer(serializers.Serializer):
    """Visibility of some types in one branch × trade type — or in every branch / every trade type."""
    branch = _DigitsIntegerField(label='بندر')
    trade_type = serializers.ChoiceField(choices=Transaction.TradeType.choices, label='نوع معامله')
    all_branches = serializers.BooleanField(default=False, label='همهٔ بندرها')
    all_trade_types = serializers.BooleanField(default=False, label='همهٔ انواع تجارت')
    rows = MoneyVisibilityRowSerializer(many=True)
