from django.db.models import Count
from django_filters.rest_framework import DjangoFilterBackend, FilterSet
from rest_framework import filters, viewsets
from rest_framework.exceptions import PermissionDenied

from api.filters import ShamsiDateFilter
from api.mixins import PortScopedQuerysetMixin, own_branch_kwargs
from api.permissions import IsBranchStaff
from api.serializers import DocumentSerializer, TransactionSerializer
from finance.utils import require_todays_usd_rate
from operations.models import Document, Transaction


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
