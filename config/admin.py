from django import forms
from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import DocumentRequirement, FieldConfig, configurable_transaction_fields


class FieldConfigForm(forms.ModelForm):
    class Meta:
        model = FieldConfig
        fields = '__all__'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if 'field_name' in self.fields:  # only on the add form; read-only afterwards
            self.fields['field_name'] = forms.ChoiceField(
                label=FieldConfig._meta.get_field('field_name').verbose_name,
                choices=[('', '---------')] + [(name, f'{label} ({name})')
                                               for name, label in configurable_transaction_fields()],
            )


@admin.register(FieldConfig)
class FieldConfigAdmin(SimpleHistoryAdmin):
    form = FieldConfigForm
    list_display = ('branch', 'trade_type', 'field_label_fa', 'field_name',
                    'visibility', 'sort_order')
    list_editable = ('visibility', 'sort_order')
    list_filter = ('branch', 'trade_type', 'visibility')
    search_fields = ('field_label_fa', 'field_name')
    list_select_related = ('branch',)
    ordering = ('branch', 'trade_type', 'sort_order', 'field_name')
    fieldsets = (
        ('هدف', {'fields': ('branch', 'trade_type')}),
        ('فیلد', {'fields': ('field_name', 'field_label_fa')}),
        ('نمایش', {'fields': ('visibility', 'sort_order')}),
    )

    def get_readonly_fields(self, request, obj=None):
        # label is editable but the technical name is fixed once the row exists
        return ('field_name',) if obj else ()


@admin.register(DocumentRequirement)
class DocumentRequirementAdmin(SimpleHistoryAdmin):
    list_display = ('branch', 'trade_type', 'doc_type', 'required')
    list_editable = ('required',)
    list_filter = ('branch', 'trade_type', 'required', 'doc_type')
    list_select_related = ('branch', 'doc_type')
    ordering = ('branch', 'trade_type', 'doc_type__sort_order')
    fields = ('branch', 'trade_type', 'doc_type', 'required')

    def get_readonly_fields(self, request, obj=None):
        return ('branch', 'trade_type', 'doc_type') if obj else ()
