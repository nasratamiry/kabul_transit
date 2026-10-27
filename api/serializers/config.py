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
    """One input of the dynamic Transaction form."""
    field_name = serializers.CharField()
    label_fa = serializers.CharField(source='field_label_fa')
    visibility = serializers.CharField()
    required = serializers.SerializerMethodField()
    sort_order = serializers.IntegerField()

    def get_required(self, obj):
        return obj.visibility == FieldConfig.Visibility.REQUIRED


class FormConfigSerializer(serializers.Serializer):
    """
    NOT tied to a model: the whole form for one (branch, trade_type), built from
    that branch's FieldConfig rows. Hidden fields are left out; the rest come in
    sort_order (never alphabetical). Pass the FieldConfig rows as `form_fields`.
    """
    branch = serializers.IntegerField()
    trade_type = serializers.ChoiceField(choices=Transaction.TradeType.choices)
    trade_type_label = serializers.SerializerMethodField()
    form_fields = serializers.SerializerMethodField()

    def get_trade_type_label(self, obj):
        return Transaction.TradeType(obj['trade_type']).label

    def get_form_fields(self, obj):
        visible = [row for row in obj['form_fields'] if row.visibility != FieldConfig.Visibility.HIDDEN]
        visible.sort(key=lambda row: (row.sort_order, row.field_name))
        return FormFieldSerializer(visible, many=True).data
