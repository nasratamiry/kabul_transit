from decimal import Decimal

from django.db.models import Count
from django_filters.rest_framework import DjangoFilterBackend, FilterSet
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from api.filters import ShamsiDateFilter
from api.mixins import PortScopedQuerysetMixin, own_branch_kwargs
from api.permissions import IsBranchStaff
from api.serializers import DocumentSerializer, TransactionSerializer
from finance.utils import require_todays_usd_rate
from kabulcargo_backend.utils import normalize_digits, parse_decimal
from operations.models import Document, Transaction

_MONEY_FIELDS = ('customer_payment', *Transaction.EXPENSE_FIELDS)


def _decimal_or(value, default):
    """Tolerant parse for the preview: Dari/Arabic digits, '٫' decimal mark; junk → default."""
    if value in (None, ''):
        return default
    try:
        number = parse_decimal(normalize_digits(str(value)).replace('٫', '.'))
    except (ValueError, TypeError):
        return default
    return number if number.is_finite() else default


class TransactionPagination(PageNumberPagination):
    """Transactions grow every day, so this list (only) is paged: 25 by default, ?page_size= up to 200."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 200


class TransactionFilter(FilterSet):
    date = ShamsiDateFilter(field_name='date')
    date_from = ShamsiDateFilter(field_name='date', lookup_expr='gte')
    date_to = ShamsiDateFilter(field_name='date', lookup_expr='lte')

    class Meta:
        model = Transaction
        fields = ['trade_type', 'status', 'branch', 'trader', 'transport_company']


class TransactionViewSet(PortScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = (Transaction.objects.select_related('branch', 'trader', 'transport_company')
                .annotate(documents_count=Count('documents')))
    serializer_class = TransactionSerializer
    permission_classes = [IsBranchStaff]
    pagination_class = TransactionPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = TransactionFilter
    search_fields = ['serial_number', 'plate_afghan', 'driver_name',
                     'trader__name', 'trader__company_name']
    ordering_fields = ['date', 'serial_number', 'balance', 'created_at']
    ordering = ['-date', '-id']

    def perform_create(self, serializer):
        require_todays_usd_rate()  # raises TodayRateMissing → 428
        user = self.request.user
        serializer.save(created_by=user, **own_branch_kwargs(user))

    def perform_update(self, serializer):
        serializer.save(**own_branch_kwargs(self.request.user))

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
        tx = Transaction(currency=currency,
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
            'customer_payment_afn': text((tx.customer_payment * tx.rate_to_afn).quantize(Decimal('0.01'))),
            'total_expense_afn': text(tx.total_expense_afn),
            'profit_or_loss_afn': text(tx.profit_or_loss_afn),
            'fee_per_dollar_afn': text(tx.fee_per_dollar_afn),
            'total_expense_usd': text(tx.total_expense_usd),
            'profit_or_loss_usd': text(tx.profit_or_loss_usd),
        })


class DocumentViewSet(PortScopedQuerysetMixin, viewsets.ModelViewSet):
    branch_field = 'transaction__branch'
    queryset = Document.objects.select_related('transaction__branch', 'uploaded_by')
    serializer_class = DocumentSerializer
    permission_classes = [IsBranchStaff]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['transaction']

    def _check_transaction_branch(self, serializer):
        # A manager may not attach a file to another branch's transaction.
        user = self.request.user
        tx = serializer.validated_data.get('transaction')
        if user.is_branch_manager and tx is not None and tx.branch_id != user.branch_id:
            raise PermissionDenied('این معامله مربوط بندر شما نیست.')

    def perform_create(self, serializer):
        self._check_transaction_branch(serializer)
        serializer.save(uploaded_by=self.request.user)

    def perform_update(self, serializer):
        self._check_transaction_branch(serializer)
        serializer.save()
