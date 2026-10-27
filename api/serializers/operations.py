import mimetypes
import os

from rest_framework import serializers
from rest_framework.reverse import reverse

from config.models import DocumentRequirement
from operations.documents import documents_status
from operations.models import Document, DocumentType, Transaction

from .base import KabulModelSerializer


def _decimal_str(value):
    return None if value is None else str(value)


class TransactionSerializer(KabulModelSerializer):
    """
    One truck / registration. `date` is a Shamsi 'YYYY-MM-DD' string.
    Traders and transport companies are shared across branches, so their
    branch is not checked.
    """
    trader_name = serializers.CharField(source='trader.name', read_only=True, default=None)
    transport_company_name = serializers.CharField(source='transport_company.name', read_only=True, default=None)
    row_summary = serializers.SerializerMethodField(label='خلاصهٔ ردیف')
    documents_count = serializers.SerializerMethodField(label='تعداد اسناد')
    documents_status = serializers.SerializerMethodField(label='وضعیت اسناد')

    class Meta:
        model = Transaction
        fields = '__all__'
        read_only_fields = ('balance', 'created_by', 'created_at', 'updated_at')
        digit_fields = (
            'serial_number', 't1_number', 't2_number', 'cmr_number', 'mafi_number', 'exit_slip_number',
            'plate_afghan', 'plate_foreign', 'driver_phone', 'bank_tariff_slip_number',
            'scale_ticket_number', 'seal_number',
        )

    def get_row_summary(self, obj):
        # USD figures are None when fee_per_dollar_afn is unknown (see the model).
        return {
            'total_expense_afn': _decimal_str(obj.total_expense_afn),
            'fee_per_dollar_afn': _decimal_str(obj.fee_per_dollar_afn),
            'total_expense_usd': _decimal_str(obj.total_expense_usd),
            'profit_or_loss_afn': _decimal_str(obj.profit_or_loss_afn),
            'profit_or_loss_usd': _decimal_str(obj.profit_or_loss_usd),
        }

    def get_documents_count(self, obj):
        # Viewsets may annotate documents_count to avoid one query per row.
        count = getattr(obj, 'documents_count', None)
        return count if count is not None else obj.documents.count()

    def get_documents_status(self, obj):
        # {required, present, missing}: document type codes. Lists preload it (attach_documents_status).
        return documents_status(obj)


def _type_names(doc_type):
    return {'fa': doc_type.name_fa, 'ps': doc_type.name_ps or doc_type.name_fa,
            'en': doc_type.name_en or doc_type.name_fa}


class DocumentTypeSerializer(KabulModelSerializer):
    """A document type (T1, CMR, ...). `code` is fixed once saved, like a branch code."""
    documents_count = serializers.IntegerField(read_only=True, default=0, label='تعداد اسناد')

    class Meta:
        model = DocumentType
        fields = ('id', 'code', 'name_fa', 'name_ps', 'name_en', 'number_field', 'sort_order', 'is_active',
                  'documents_count')

    def to_internal_value(self, data):
        # Upper-case before the field's own validator (A-Z only) runs: «t1» is accepted as «T1».
        if isinstance(data.get('code'), str):
            data = {**data, 'code': data['code'].strip().upper()}
        return super().to_internal_value(data)

    def validate_code(self, value):
        if self.instance is not None and value != self.instance.code:
            raise serializers.ValidationError('کود نوع سند بعد از ثبت تغییر کرده نمی‌تواند.')
        return value


class DocumentRequirementSerializer(KabulModelSerializer):
    doc_type_code = serializers.CharField(source='doc_type.code', read_only=True)

    class Meta:
        model = DocumentRequirement
        fields = ('id', 'branch', 'trade_type', 'doc_type', 'doc_type_code', 'required')


class DocumentSerializer(KabulModelSerializer):
    """
    The stored file is never exposed as a /media/ URL: in production nginx would serve that to
    anyone holding the link. Files are read through download_url (authenticated, branch-checked).
    `file` is write-only (upload) and keeps the model's size / extension / magic-bytes validators.
    `doc_type` is read and written as the type's code (T1, CMR, ...).
    number_sync (only in the response of an upload / edit) tells whether doc_number filled the
    transaction's number field or differs from it; number_mismatch is the transaction's own
    number whenever it differs from this document's number.
    """
    doc_type = serializers.SlugRelatedField(slug_field='code', queryset=DocumentType.objects.all(),
                                            label='نوع سند')
    doc_type_names = serializers.SerializerMethodField(label='نام نوع سند')
    download_url = serializers.SerializerMethodField(label='نشانی دانلود')
    file_name = serializers.SerializerMethodField(label='نام فایل')
    file_size = serializers.SerializerMethodField(label='حجم فایل (بایت)')
    content_type = serializers.SerializerMethodField(label='نوع فایل')
    uploaded_by_name = serializers.CharField(source='uploaded_by.get_full_name', read_only=True, default=None)
    uploaded_by_username = serializers.CharField(source='uploaded_by.username', read_only=True, default=None)
    number_field = serializers.CharField(read_only=True, label='فیلد نمبر در معامله')
    number_mismatch = serializers.SerializerMethodField(label='نمبر متفاوت در معامله')
    number_sync = serializers.SerializerMethodField(label='نتیجهٔ مقایسهٔ نمبر')
    transaction_info = serializers.SerializerMethodField(label='معامله')

    class Meta:
        model = Document
        fields = ('id', 'transaction', 'transaction_info', 'doc_type', 'doc_type_names', 'doc_number',
                  'issue_date', 'note', 'file', 'title', 'uploaded_at', 'uploaded_by', 'uploaded_by_name',
                  'uploaded_by_username', 'download_url', 'file_name', 'file_size', 'content_type',
                  'number_field', 'number_mismatch', 'number_sync')
        read_only_fields = ('uploaded_at', 'uploaded_by')
        extra_kwargs = {'file': {'write_only': True}}
        digit_fields = ('doc_number',)

    def validate_doc_type(self, value):
        changed = self.instance is None or self.instance.doc_type_id != value.pk
        if changed and not value.is_active:
            raise serializers.ValidationError('این نوع سند غیرفعال است.')
        return value

    def validate(self, attrs):
        if self.instance is not None and 'transaction' in attrs and attrs['transaction'] != self.instance.transaction:
            raise serializers.ValidationError({'transaction': 'سند را به معاملهٔ دیگر منتقل کرده نمی‌توانید.'})
        return super().validate(attrs)

    def get_doc_type_names(self, obj):
        return _type_names(obj.doc_type)

    def get_download_url(self, obj):
        return reverse('document-download', args=[obj.pk])

    def get_file_name(self, obj):
        return os.path.basename(obj.file.name)

    def get_file_size(self, obj):
        try:
            return obj.file.size
        except (FileNotFoundError, OSError):
            return None

    def get_content_type(self, obj):
        return mimetypes.guess_type(obj.file.name)[0] or 'application/octet-stream'

    def get_number_mismatch(self, obj):
        return obj.number_mismatch()

    def get_number_sync(self, obj):
        return getattr(obj, '_number_sync', None)

    def get_transaction_info(self, obj):
        tx = obj.transaction
        return {'id': tx.pk, 'serial_number': tx.serial_number, 'trade_type': tx.trade_type,
                'date': str(tx.date), 'branch': tx.branch_id, 'branch_name': tx.branch.name,
                'plate_afghan': tx.plate_afghan}
