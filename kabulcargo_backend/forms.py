from django import forms

from kabulcargo_backend.utils import normalize_digits

_NUMERIC_FORM_FIELDS = (forms.DecimalField, forms.IntegerField, forms.FloatField)


class DigitNormalizingModelForm(forms.ModelForm):
    """
    Accepts Persian/Arabic digits in numeric inputs by converting them to English
    before Django parses the form. Char fields listed in `digit_fields` (document
    numbers, plates, phones) are normalized too.
    """

    digit_fields = ()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.is_bound:
            return
        data = self.data.copy()
        for name, field in self.fields.items():
            if not (isinstance(field, _NUMERIC_FORM_FIELDS) or name in self.digit_fields):
                continue
            key = self.add_prefix(name)
            if key not in data:
                continue
            value = normalize_digits(data[key])
            if isinstance(field, _NUMERIC_FORM_FIELDS):
                value = value.replace(',', '').replace(' ', '')  # drop thousands separators
            data[key] = value
        self.data = data
