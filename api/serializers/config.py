from rest_framework import serializers

from config.models import FieldConfig
from operations.models import Transaction

from .base import KabulModelSerializer


class FieldConfigSerializer(KabulModelSerializer):
    class Meta:
        model = FieldConfig
        fields = '__all__'


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
