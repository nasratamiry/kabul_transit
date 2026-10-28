import mimetypes
import os
from decimal import Decimal, InvalidOperation

from rest_framework import serializers
from rest_framework.reverse import reverse

from config.models import DocumentRequirement, FieldConfig
from kabulcargo_backend.utils import normalize_digits
from operations.documents import documents_status
from operations.models import Document, DocumentType, MoneyFieldType, Transaction, TransactionMoneyLine

from .base import KabulModelSerializer


def _decimal_str(value):
    return None if value is None else str(value)


MAX_AMOUNT = Decimal('999999999999.99')


def parse_amount(value):
    """
    One typed amount → Decimal (Dari / Arabic digits, '٫' and thousands commas allowed).
    '' / None → None (left empty). Raises ValueError with a Dari message when it is not a
    non-negative number with at most 2 decimals.
    """
    if value is None:
        return None
    text = normalize_digits(str(value)).replace(',', '').replace(' ', '')
    if text == '':
        return None
    try:
        number = Decimal(text)
    except InvalidOperation:
        raise ValueError('یک عدد درست بنویسید.')
    if not number.is_finite() or number < 0:
        raise ValueError('مبلغ نمی‌تواند منفی باشد.')
    if number > MAX_AMOUNT or number.as_tuple().exponent < -2:
        raise ValueError('حداکثر ۱۲ رقم و ۲ رقم اعشار.')
    return number


class MoneyAmountsField(serializers.Field):
    """
    The amounts of the revenue / expense types added by the super admin, as {code: amount}
    (the built-in ones are ordinary columns). On write only the codes sent are changed; an
    empty or 0 amount removes that type's amount. Read: every non-zero amount.
    """

    def get_attribute(self, instance):
        return instance

    def to_representation(self, tx):
        by_id = tx.money_types().by_id
        return {by_id[type_id].code: str(amount) for type_id, amount in tx.line_amounts().items()
                if type_id in by_id and amount}

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError('باید فهرست {کود: مبلغ} باشد.')
        values, errors = {}, {}
        for code, value in data.items():
            code = str(code).strip().upper()
            try:
                values[code] = parse_amount(value)
            except ValueError as exc:
                errors[code] = str(exc)
        if errors:
            raise serializers.ValidationError(errors)
        return values


class TransactionSerializer(KabulModelSerializer):
    """
    One truck / registration. `date` is a Shamsi 'YYYY-MM-DD' string.
    Traders and transport companies are shared across branches, so their
    branch is not checked. Revenue vs expense of every amount follows its MoneyFieldType.
    """
    trader_name = serializers.CharField(source='trader.name', read_only=True, default=None)
    transport_company_name = serializers.CharField(source='transport_company.name', read_only=True, default=None)
    money_amounts = MoneyAmountsField(required=False, label='مبالغ انواع اضافه‌شده')
    money_items = serializers.SerializerMethodField(label='همهٔ مبالغ')
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

    def validate(self, attrs):
        amounts = attrs.get('money_amounts')
        if amounts:
            types = MoneyFieldType.objects.in_bulk(list(amounts), field_name='code')
            existing = ({line.field_type.code: line.amount for line in
                         self.instance.money_lines.select_related('field_type')} if self.instance else {})
            errors = {}
            for code, amount in amounts.items():
                money_type = types.get(code)
                if money_type is None or money_type.column:
                    errors[code] = 'این نوع عاید / مصرف پیدا نشد.'
                elif not money_type.is_active and (amount or 0) != existing.get(code, 0):
                    errors[code] = f'«{money_type.name_fa}» غیرفعال است؛ مبلغ تازه برایش ثبت نمی‌شود.'
            if errors:
                raise serializers.ValidationError({'money_amounts': errors})
        if self.instance is None:
            self._check_required(attrs, amounts or {})
        return super().validate(attrs)

    def _check_required(self, attrs, amounts):
        """An added type that is «لازم» for this branch × trade type must have an amount on create."""
        branch, trade_type = attrs.get('branch'), attrs.get('trade_type')
        if branch is None or trade_type is None:
            return
        required = FieldConfig.objects.filter(
            branch=branch, trade_type=trade_type, visibility=FieldConfig.Visibility.REQUIRED,
            money_type__column='', money_type__is_active=True).select_related('money_type')
        missing = {row.money_type.code: 'این مبلغ لازم است.' for row in required
                   if amounts.get(row.money_type.code) is None}
        if missing:
            raise serializers.ValidationError({'money_amounts': missing})

    def create(self, validated_data):
        amounts = validated_data.pop('money_amounts', None) or {}
        instance = Transaction(**validated_data)
        self._stage(instance, amounts)
        instance.save()
        self._write_lines(instance, amounts)
        return instance

    def update(self, instance, validated_data):
        amounts = validated_data.pop('money_amounts', None) or {}
        self._stage(instance, amounts)
        instance = super().update(instance, validated_data)
        self._write_lines(instance, amounts)
        return instance

    @staticmethod
    def _stage(instance, amounts):
        """Put the new amounts on the instance before save(), so the stored balance includes them."""
        if not amounts:
            return
        types = MoneyFieldType.objects.in_bulk(list(amounts), field_name='code')
        staged = dict(instance.line_amounts())
        for code, amount in amounts.items():
            if amount:
                staged[types[code].pk] = amount
            else:
                staged.pop(types[code].pk, None)
        instance._line_amounts = staged

    @staticmethod
    def _write_lines(instance, amounts):
        """One history row per amount added, changed or removed."""
        if not amounts:
            return
        lines = {line.field_type.code: line
                 for line in instance.money_lines.select_related('field_type').filter(field_type__code__in=amounts)}
        types = MoneyFieldType.objects.in_bulk(list(amounts), field_name='code')
        for code, amount in amounts.items():
            line = lines.get(code)
            if not amount:
                if line is not None:
                    line.delete()
            elif line is None:
                TransactionMoneyLine.objects.create(transaction=instance, field_type=types[code], amount=amount)
            elif line.amount != amount:
                line.amount = amount
                line.save(update_fields=['amount'])
        instance.forget_money()

    def get_money_items(self, obj):
        """Every non-zero amount (customer_payment always), in form order, with its kind and AFN / USD value."""
        rate = obj.rate_to_afn
        usd_rate = obj.fee_per_dollar_afn
        items = []
        for money_type, amount in obj.money_items():
            afn = (amount * rate).quantize(Decimal('0.01'))
            if obj.currency == Transaction.Currency.USD:
                usd = amount
            else:
                usd = (afn / usd_rate).quantize(Decimal('0.01')) if usd_rate else None
            items.append({'code': money_type.code, 'source': money_type.source, 'kind': money_type.kind,
                          'section': money_type.section, 'names': money_type.names(),
                          'is_active': money_type.is_active, 'amount': str(amount),
                          'amount_afn': str(afn), 'amount_usd': _decimal_str(usd)})
        return items

    def get_row_summary(self, obj):
        # USD figures are None when fee_per_dollar_afn is unknown (see the model).
        return {
            'total_revenue_afn': _decimal_str(obj.total_revenue_afn),
            'total_revenue_usd': _decimal_str(obj.total_revenue_usd),
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
