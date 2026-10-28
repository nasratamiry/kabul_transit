from rest_framework import serializers

from accounts.models import Branch
from config.models import LOCKED_FIELDS, FieldConfig
from kabulcargo_backend.utils import normalize_digits
from operations.models import Transaction

from .base import KabulModelSerializer


class FieldConfigSerializer(KabulModelSerializer):
    locked = serializers.SerializerMethodField(label='قفل')

    class Meta:
        model = FieldConfig
        fields = '__all__'

    def get_locked(self, obj):
        return obj.field_name in LOCKED_FIELDS


class _DigitsIntegerField(serializers.IntegerField):
    """An integer that may be typed with Dari / Arabic digits."""

    def to_internal_value(self, data):
        return super().to_internal_value(normalize_digits(str(data)) if isinstance(data, str) else data)


class _DigitsBranchField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, data):
        return super().to_internal_value(normalize_digits(str(data)) if isinstance(data, str) else data)


class FieldConfigScopeSerializer(serializers.Serializer):
    """One branch × trade type: the scope of a reset, and of a copy's source."""
    branch = _DigitsBranchField(queryset=Branch.objects.all(), label='بندر')
    trade_type = serializers.ChoiceField(choices=Transaction.TradeType.choices, label='نوع معامله')


class FieldConfigBulkRowSerializer(serializers.Serializer):
    id = _DigitsIntegerField(label='شناسه')
    visibility = serializers.ChoiceField(choices=FieldConfig.Visibility.choices, label='وضعیت')
    sort_order = _DigitsIntegerField(min_value=0, max_value=2_147_483_647, label='ترتیب نمایش')


class FieldConfigCopySerializer(serializers.Serializer):
    """
    Source branch × trade type → one target branch, or every other branch (all_branches).
    target_trade_type defaults to the source's.
    """
    source_branch = _DigitsBranchField(queryset=Branch.objects.all(), label='بندر مبدأ')
    source_trade_type = serializers.ChoiceField(choices=Transaction.TradeType.choices, label='نوع معاملهٔ مبدأ')
    target_branch = _DigitsBranchField(queryset=Branch.objects.all(), required=False, allow_null=True,
                                       label='بندر مقصد')
    target_trade_type = serializers.ChoiceField(choices=Transaction.TradeType.choices, required=False,
                                                label='نوع معاملهٔ مقصد')
    all_branches = serializers.BooleanField(default=False, label='همهٔ بندرها')

    def validate(self, attrs):
        attrs.setdefault('target_trade_type', attrs['source_trade_type'])
        if attrs['all_branches']:
            attrs['target_branch'] = None
        elif not attrs.get('target_branch'):
            raise serializers.ValidationError({'target_branch': 'بندر مقصد را انتخاب کنید.'})
        elif (attrs['target_branch'] == attrs['source_branch']
              and attrs['target_trade_type'] == attrs['source_trade_type']):
            raise serializers.ValidationError({'target_branch': 'مبدأ و مقصد یکی است.'})
        return attrs


class FormFieldSerializer(serializers.Serializer):
    """
    One input of the dynamic Transaction form. A revenue / expense type also carries `money`:
    {code, kind, section, names} — the form puts it in its «عواید» or «مصارف» section by kind.
    """
    field_name = serializers.CharField()
    label_fa = serializers.SerializerMethodField()
    visibility = serializers.CharField()
    required = serializers.SerializerMethodField()
    sort_order = serializers.SerializerMethodField()
    money = serializers.SerializerMethodField()

    def get_label_fa(self, obj):
        return obj.money_type.name_fa if obj.money_type_id else obj.field_label_fa

    def get_required(self, obj):
        return obj.visibility == FieldConfig.Visibility.REQUIRED

    def get_sort_order(self, obj):
        # Money types are ordered on the «عواید و مصارف» page, the same in every branch.
        return obj.money_type.sort_order if obj.money_type_id else obj.sort_order

    def get_money(self, obj):
        t = obj.money_type
        if t is None:
            return None
        return {'code': t.code, 'kind': t.kind, 'section': t.section, 'names': t.names()}


class FormConfigSerializer(serializers.Serializer):
    """
    NOT tied to a model: the whole form for one (branch, trade_type), built from
    that branch's FieldConfig rows. Hidden fields and inactive money types are left out; the
    rest come in sort_order (never alphabetical). Pass the FieldConfig rows as `form_fields`
    (with money_type selected).
    """
    branch = serializers.IntegerField()
    trade_type = serializers.ChoiceField(choices=Transaction.TradeType.choices)
    trade_type_label = serializers.SerializerMethodField()
    form_fields = serializers.SerializerMethodField()

    def get_trade_type_label(self, obj):
        return Transaction.TradeType(obj['trade_type']).label

    def get_form_fields(self, obj):
        visible = [row for row in obj['form_fields'] if row.visibility != FieldConfig.Visibility.HIDDEN
                   and (row.money_type is None or row.money_type.is_active)]
        visible.sort(key=lambda row: (row.money_type.sort_order if row.money_type else row.sort_order,
                                      row.field_name))
        return FormFieldSerializer(visible, many=True).data
