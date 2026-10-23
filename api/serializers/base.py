import copy

from django.core.exceptions import ValidationError as DjangoValidationError
from django_jalali.db import models as jmodels
from django_jalali.serializers.serializerfield import JDateField
from rest_framework import serializers

from kabulcargo_backend.utils import normalize_digits

_NUMERIC_FIELDS = (serializers.DecimalField, serializers.IntegerField, serializers.FloatField)
_DATE_FIELDS = (serializers.DateField,)


class KabulModelSerializer(serializers.ModelSerializer):
    """
    Base for every API serializer:
    - jDateField is read/written as a Shamsi 'YYYY-MM-DD' string (not Gregorian);
    - Persian/Arabic digits are accepted in numeric and date inputs, and in any
      char field listed in Meta.digit_fields (document numbers, plates, phones);
    - the model's own clean() rules (role/branch, future rate dates, negative
      amounts, ...) run on every write, exactly as in the admin.
    """

    serializer_field_mapping = {
        **serializers.ModelSerializer.serializer_field_mapping,
        jmodels.jDateField: JDateField,
    }

    def to_internal_value(self, data):
        if hasattr(data, 'copy'):
            data = data.copy()
            digit_fields = set(getattr(self.Meta, 'digit_fields', ()))
            for name, field in self.fields.items():
                if field.read_only or name not in data or not isinstance(data[name], str):
                    continue
                if isinstance(field, _NUMERIC_FIELDS):
                    data[name] = normalize_digits(data[name]).replace(',', '').replace(' ', '')
                elif isinstance(field, _DATE_FIELDS) or name in digit_fields:
                    data[name] = normalize_digits(data[name])
        return super().to_internal_value(data)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        model = self.Meta.model
        instance = copy.copy(self.instance) if self.instance is not None else model()
        many_to_many = {field.name for field in model._meta.many_to_many}
        for name, value in attrs.items():
            if name not in many_to_many:
                setattr(instance, name, value)
        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, 'error_dict') else exc.messages)
        # clean() may normalize values (e.g. digits); keep what it produced
        for name in attrs:
            if name not in many_to_many:
                attrs[name] = getattr(instance, name)
        return attrs
