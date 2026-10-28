import copy

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import QueryDict
from django_jalali.db import models as jmodels
from django_jalali.serializers.serializerfield import JDateField
from rest_framework import serializers

from kabulcargo_backend.utils import normalize_digits, sanitize_text

_NUMERIC_FIELDS = (serializers.DecimalField, serializers.IntegerField, serializers.FloatField)
_DATE_FIELDS = (serializers.DateField,)

# Limit for free-text fields that have no max_length of their own (TextField:
# remarks, note, description).
FREE_TEXT_MAX_LENGTH = 2000


class KabulModelSerializer(serializers.ModelSerializer):
    """
    Base for every API serializer:
    - jDateField is read/written as a Shamsi 'YYYY-MM-DD' string (not Gregorian);
    - Persian/Arabic digits are accepted in numeric and date inputs, and in any
      char field listed in Meta.digit_fields (document numbers, plates, phones);
    - every text input is sanitized (HTML stripped with bleach, control
      characters removed, length bounded) — passwords excepted;
    - the model's own clean() rules (role/branch, future rate dates, negative
      amounts, ...) run on every write, exactly as in the admin.
    """

    serializer_field_mapping = {
        **serializers.ModelSerializer.serializer_field_mapping,
        jmodels.jDateField: JDateField,
    }

    def to_internal_value(self, data):
        if isinstance(data, QueryDict):
            # Shallow copy. QueryDict.copy() deep-copies, which fails on uploads
            # big enough to be spooled to a temporary file (> 2.5 MB).
            shallow = QueryDict(mutable=True, encoding=data.encoding)
            for key, values in data.lists():
                shallow.setlist(key, values)
            data = shallow
        elif hasattr(data, 'copy'):
            data = data.copy()
        if hasattr(data, 'copy'):
            digit_fields = set(getattr(self.Meta, 'digit_fields', ()))
            errors = {}
            for name, field in self.fields.items():
                if field.read_only or name not in data or not isinstance(data[name], str):
                    continue
                if isinstance(field, _NUMERIC_FIELDS):
                    data[name] = normalize_digits(data[name]).replace(',', '').replace(' ', '')
                elif isinstance(field, _DATE_FIELDS) or name in digit_fields:
                    data[name] = normalize_digits(data[name])
                if isinstance(field, serializers.CharField) and field.style.get('input_type') != 'password':
                    try:
                        data[name] = sanitize_text(data[name], field.max_length or FREE_TEXT_MAX_LENGTH)
                    except DjangoValidationError as exc:
                        errors[name] = exc.messages
            if errors:
                raise serializers.ValidationError(errors)
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


def free_code(model, name, fallback):
    """
    A code for a new admin-managed row when none was typed: the English name in A-Z0-9_
    (else `fallback`), cut to the field's length and made unique with a number.
    """
    import re
    max_length = model._meta.get_field('code').max_length
    base = re.sub(r'[^A-Z0-9]+', '_', name.upper()).strip('_')
    if not base or not base[0].isalpha():
        base = fallback
    base = base[:max_length]
    candidate, n = base, 2
    while model.objects.filter(code=candidate).exists():
        suffix = f'_{n}'
        candidate, n = base[:max_length - len(suffix)] + suffix, n + 1
    return candidate
