import mimetypes
import os
import re
from decimal import Decimal
from urllib.parse import quote

import django_filters
from django.conf import settings
from django.db import transaction as db_transaction
from django.db.models import Count, Exists, OuterRef
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from django.utils.http import content_disposition_header
from django_filters.rest_framework import DjangoFilterBackend, FilterSet
from rest_framework import filters, serializers, viewsets
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.response import Response

from accounts.models import Branch
from api.excel import transactions_workbook, xlsx_response
from api.filters import DigitSearchFilter, ShamsiDateFilter, parse_any_date
from api.history import HistoryMixin
from api.mixins import PortScopedQuerysetMixin, own_branch_kwargs
from api.pagination import OptionalPagination, StandardPagination
from api.permissions import IsBranchStaff, IsSuperAdmin, ReadOnlyForBranch
from api.serializers import (DocumentRequirementSerializer, DocumentSerializer, DocumentTypeSerializer,
                             TransactionSerializer)
from config.models import DocumentRequirement
from finance.utils import attach_usd_rates, kabul_today, require_todays_usd_rate
from kabulcargo_backend.security import log_event
from kabulcargo_backend.utils import dual_date, normalize_digits, parse_decimal
from operations.documents import attach_documents_status, missing_documents_condition
from operations.models import Document, DocumentType, Transaction

_MONEY_FIELDS = ('customer_payment', *Transaction.EXPENSE_FIELDS)


def _decimal_or(value, default):
    """Tolerant parse for the preview: Dari/Arabic digits, '٫' decimal mark; junk → default."""
    if value in (None, ''):
        return default
    try:
        number = parse_decimal(value)
    except (ValueError, TypeError):
        return default
    return number if number.is_finite() else default


MAX_EXPORT_ROWS = 20000


class TransactionFilter(FilterSet):
    date = ShamsiDateFilter(field_name='date')
    date_from = ShamsiDateFilter(field_name='date', lookup_expr='gte')
    date_to = ShamsiDateFilter(field_name='date', lookup_expr='lte')
    has_documents = django_filters.BooleanFilter(method='filter_has_documents', label='دارای سند')
    missing_documents = django_filters.BooleanFilter(method='filter_missing_documents', label='سند ناقص')
    doc_type = django_filters.CharFilter(method='filter_doc_type', label='دارای نوع سند (کود)')
    # Income-statement drill-down: rows where this money field (customer_payment or an expense) is non-zero.
    nonzero = django_filters.ChoiceFilter(
        method='filter_nonzero', label='فیلد غیر صفر',
        choices=[(name, name) for name in ('customer_payment', *Transaction.EXPENSE_FIELDS)])

    class Meta:
        model = Transaction
        fields = ['trade_type', 'status', 'branch', 'trader', 'transport_company']

    def filter_has_documents(self, queryset, name, value):
        # documents_count is annotated by TransactionViewSet.queryset
        return queryset.filter(documents_count__gt=0) if value else queryset.filter(documents_count=0)

    def filter_missing_documents(self, queryset, name, value):
        condition = missing_documents_condition()
        return queryset.filter(condition) if value else queryset.exclude(condition)

    def filter_doc_type(self, queryset, name, value):
        # Exists, not a join: a join would multiply the annotated documents_count.
        return queryset.filter(Exists(Document.objects.filter(transaction=OuterRef('pk'),
                                                              doc_type__code=value.strip().upper())))

    def filter_nonzero(self, queryset, name, value):
        return queryset.exclude(**{value: 0})


class TransactionViewSet(HistoryMixin, PortScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = (Transaction.objects.select_related('branch', 'trader', 'transport_company')
                .annotate(documents_count=Count('documents')))
    serializer_class = TransactionSerializer
    permission_classes = [IsBranchStaff]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = TransactionFilter
    search_fields = ['serial_number', 'plate_afghan', 'driver_name',
                     'trader__name', 'trader__company_name']
    ordering_fields = ['date', 'serial_number', 'balance', 'created_at']
    ordering = ['-date', '-id']

    def paginate_queryset(self, queryset):
        # Each row's USD figures need the USD rate of its date: load them for the whole page at once.
        page = super().paginate_queryset(queryset)
        if page is not None:
            attach_usd_rates(page)
            attach_documents_status(page)
        return page

    def perform_create(self, serializer):
        require_todays_usd_rate()  # raises TodayRateMissing → 428
        user = self.request.user
        serializer.save(created_by=user, **own_branch_kwargs(user))

    def perform_update(self, serializer):
        serializer.save(**own_branch_kwargs(self.request.user))

    @action(detail=False, methods=['get'])
    def export(self, request):
        """
        GET /api/transactions/export/?<the list's filters> — every filtered row (not one page)
        as .xlsx, with the list's own filters, search and branch scoping.
        """
        rows = list(self.filter_queryset(self.get_queryset())[:MAX_EXPORT_ROWS + 1])
        if len(rows) > MAX_EXPORT_ROWS:
            return Response({'detail': f'بیشتر از {MAX_EXPORT_ROWS} معامله؛ بازهٔ تاریخ را کوچک‌تر کنید.'},
                            status=400)
        attach_usd_rates(rows)
        user, params = request.user, request.query_params
        branch = normalize_digits(params.get('branch') or '')
        if user.is_branch_manager:
            branch_label = user.branch.name
        elif branch.isdigit():
            branch_label = Branch.objects.filter(pk=branch).values_list('name', flat=True).first() or branch
        else:
            branch_label = 'همهٔ بندرها'
        period = f"\u200e{params.get('date_from') or '…'}\u200e تا \u200e{params.get('date_to') or '…'}\u200e"
        content = transactions_workbook(rows, branch_label, period, dual_date(timezone.now()))
        log_event('export', request, kind='transactions', rows=len(rows), query=params.urlencode()[:300])
        return xlsx_response(content, f'transactions_{kabul_today()}.xlsx')

    @action(detail=False, methods=['post'], url_path='preview-summary')
    def preview_summary(self, request):
        """
        POST /api/transactions/preview-summary/ — the row summary of unsaved form input, for the
        live panel next to the form. Nothing is saved or validated strictly: unparseable
        amounts count as 0 and an unknown currency as AFN, so a half-filled form still gets
        numbers. The figures come from the model's own properties, so they always match what
        the saved row will show. A branch manager may only preview their own branch.
        """
        user = request.user
        branch = normalize_digits(str(request.data.get('branch') or ''))
        if user.is_branch_manager and branch and branch != str(user.branch_id):
            raise PermissionDenied('این معامله مربوط بندر شما نیست.')

        currency = request.data.get('currency')
        if currency not in Transaction.Currency.values:
            currency = Transaction.Currency.AFN
        try:
            day = parse_any_date(request.data.get('date')) if request.data.get('date') else kabul_today()
        except (TypeError, ValueError):
            day = kabul_today()
        # The date matters for non-USD records: their USD figures use that day's USD rate.
        tx = Transaction(currency=currency, date=day,
                         exchange_rate=_decimal_or(request.data.get('exchange_rate'), Decimal('1')))
        if currency == Transaction.Currency.AFN or tx.exchange_rate <= 0:
            tx.exchange_rate = Decimal('1')
        for name in _MONEY_FIELDS:
            setattr(tx, name, _decimal_or(request.data.get(name), Decimal('0')))
        tx.balance = tx.customer_payment - tx.total_expense  # what save() would store

        def text(value):
            return None if value is None else str(value)

        return Response({
            'currency': currency,
            'date': str(day),
            'customer_payment_afn': text((tx.customer_payment * tx.rate_to_afn).quantize(Decimal('0.01'))),
            'total_expense_afn': text(tx.total_expense_afn),
            'profit_or_loss_afn': text(tx.profit_or_loss_afn),
            'fee_per_dollar_afn': text(tx.fee_per_dollar_afn),
            'total_expense_usd': text(tx.total_expense_usd),
            'profit_or_loss_usd': text(tx.profit_or_loss_usd),
        })


class DocumentFilter(FilterSet):
    doc_type = django_filters.CharFilter(field_name='doc_type__code', label='نوع سند (کود)')
    doc_number = django_filters.CharFilter(method='filter_doc_number', label='نمبر سند')
    date_from = ShamsiDateFilter(field_name='issue_date', lookup_expr='gte')
    date_to = ShamsiDateFilter(field_name='issue_date', lookup_expr='lte')
    branch = django_filters.NumberFilter(field_name='transaction__branch', label='بندر')
    trade_type = django_filters.ChoiceFilter(field_name='transaction__trade_type',
                                             choices=Transaction.TradeType.choices, label='نوع معامله')

    class Meta:
        model = Document
        fields = ['transaction']

    def filter_doc_number(self, queryset, name, value):
        return queryset.filter(doc_number__icontains=normalize_digits(value))


def _download_name(document):
    """«سند T1 12345-7.pdf» — readable, without characters a file system refuses."""
    ext = os.path.splitext(document.file.name)[1].lower()
    label = f'{document.doc_type.name_fa} {document.doc_number}'.strip()
    label = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', '-', label).strip(' .-')
    return f'{label or "document"}-{document.pk}{ext}'


class DocumentViewSet(HistoryMixin, PortScopedQuerysetMixin, viewsets.ModelViewSet):
    """
    Documents of the user's branch (super admin: all). Without ?page= the list is a plain array
    (the transaction page asks for one transaction's documents); with ?page= it is paginated
    (the documents register).
    """
    branch_field = 'transaction__branch'
    queryset = Document.objects.select_related('transaction__branch', 'uploaded_by', 'doc_type')
    serializer_class = DocumentSerializer
    permission_classes = [IsBranchStaff]
    pagination_class = OptionalPagination
    filter_backends = [DjangoFilterBackend, DigitSearchFilter, filters.OrderingFilter]
    filterset_class = DocumentFilter
    search_fields = ['doc_number', 'title', 'note', 'transaction__serial_number', 'transaction__plate_afghan']
    ordering_fields = ['uploaded_at', 'issue_date', 'doc_number']
    ordering = ['-uploaded_at', '-id']

    def _check_transaction_branch(self, serializer):
        # A manager may not attach a file to another branch's transaction.
        user = self.request.user
        tx = serializer.validated_data.get('transaction')
        if user.is_branch_manager and tx is not None and tx.branch_id != user.branch_id:
            raise PermissionDenied('این معامله مربوط بندر شما نیست.')

    @db_transaction.atomic
    def perform_create(self, serializer):
        self._check_transaction_branch(serializer)
        document = serializer.save(uploaded_by=self.request.user)
        document._number_sync = document.sync_number()

    @db_transaction.atomic
    def perform_update(self, serializer):
        self._check_transaction_branch(serializer)
        document = serializer.save()
        document._number_sync = document.sync_number()

    @action(detail=True, methods=['get'],
            authentication_classes=[JWTAuthentication, SessionAuthentication])  # session: admin links
    def download(self, request, pk=None):
        """
        GET /api/documents/{id}/download/[?download=1] — the file, for logged-in users of the
        document's branch only (get_object applies the branch scoping: another branch → 404).
        Inline by default (images / PDFs open in the browser); ?download=1 → attachment. With
        DOCUMENT_X_ACCEL_PREFIX set (production) nginx sends the file from an `internal`
        location; otherwise Django streams it. The file is named after its type and number.
        """
        document = self.get_object()
        name = _download_name(document)
        content_type = mimetypes.guess_type(document.file.name)[0] or 'application/octet-stream'
        as_attachment = request.query_params.get('download') in ('1', 'true')
        prefix = getattr(settings, 'DOCUMENT_X_ACCEL_PREFIX', '')
        if prefix:
            response = HttpResponse(content_type=content_type)
            response['X-Accel-Redirect'] = f"{prefix.rstrip('/')}/{quote(document.file.name)}"
            response['Content-Disposition'] = content_disposition_header(as_attachment, name)
            return response
        try:
            handle = document.file.open('rb')
        except (FileNotFoundError, OSError):
            raise NotFound('فایل این سند روی سرور پیدا نشد.')
        return FileResponse(handle, as_attachment=as_attachment, filename=name, content_type=content_type)


class DocumentTypeViewSet(HistoryMixin, viewsets.ModelViewSet):
    """Every role reads the types (upload dialog, filters); only the super admin changes them."""
    branch_field = None  # company-wide
    queryset = DocumentType.objects.annotate(documents_count=Count('documents')).order_by('sort_order', 'code')
    serializer_class = DocumentTypeSerializer
    permission_classes = [ReadOnlyForBranch]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_active']


class RequirementSetSerializer(serializers.Serializer):
    branch = serializers.IntegerField()
    trade_type = serializers.ChoiceField(choices=Transaction.TradeType.choices)
    doc_type = serializers.SlugRelatedField(slug_field='code', queryset=DocumentType.objects.all())
    required = serializers.BooleanField()


class DocumentRequirementViewSet(HistoryMixin, PortScopedQuerysetMixin, viewsets.ReadOnlyModelViewSet):
    """
    GET: the requirement grid (a manager sees their own branch's). POST set/: the super admin
    ticks / unticks one cell {branch, trade_type, doc_type (code), required}; a missing row is created.
    """
    queryset = DocumentRequirement.objects.select_related('doc_type').order_by(
        'branch', 'trade_type', 'doc_type__sort_order', 'doc_type__code')
    serializer_class = DocumentRequirementSerializer
    permission_classes = [IsBranchStaff]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['branch', 'trade_type', 'required']

    @action(detail=False, methods=['post'], url_path='set', permission_classes=[IsSuperAdmin])
    def set_required(self, request):
        data = RequirementSetSerializer(data={
            'branch': normalize_digits(str(request.data.get('branch', ''))),
            'trade_type': request.data.get('trade_type'),
            'doc_type': request.data.get('doc_type'),
            'required': request.data.get('required'),
        })
        data.is_valid(raise_exception=True)
        values = data.validated_data
        if not Branch.objects.filter(pk=values['branch']).exists():
            raise NotFound('بندر پیدا نشد.')
        row, _ = DocumentRequirement.objects.get_or_create(
            branch_id=values['branch'], trade_type=values['trade_type'], doc_type=values['doc_type'])
        if row.required != values['required']:
            row.required = values['required']
            row.save(update_fields=['required'])
        return Response(DocumentRequirementSerializer(row).data)
