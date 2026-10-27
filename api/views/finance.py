from django_filters.rest_framework import DjangoFilterBackend, FilterSet
from rest_framework import filters, viewsets
from rest_framework.exceptions import PermissionDenied

from api.filters import ShamsiDateFilter
from api.history import HistoryMixin
from api.mixins import PortScopedQuerysetMixin, own_branch_kwargs
from api.pagination import StandardPagination
from api.permissions import IsBranchStaff, IsSuperAdmin
from api.serializers import ExchangeRateSerializer, HawalaSerializer, OfficeExpenseSerializer
from finance.models import ExchangeRate, Hawala, OfficeExpense
from finance.reports import amount_totals
from finance.utils import kabul_today, require_todays_usd_rate


class ExchangeRateFilter(FilterSet):
    date = ShamsiDateFilter(field_name='date')

    class Meta:
        model = ExchangeRate
        fields = ['currency']


class HawalaFilter(FilterSet):
    date = ShamsiDateFilter(field_name='date')
    date_from = ShamsiDateFilter(field_name='date', lookup_expr='gte')
    date_to = ShamsiDateFilter(field_name='date', lookup_expr='lte')

    class Meta:
        model = Hawala
        fields = ['branch', 'currency']


class OfficeExpenseFilter(FilterSet):
    date = ShamsiDateFilter(field_name='date')
    date_from = ShamsiDateFilter(field_name='date', lookup_expr='gte')
    date_to = ShamsiDateFilter(field_name='date', lookup_expr='lte')

    class Meta:
        model = OfficeExpense
        fields = ['branch', 'category', 'currency']


class ExchangeRateViewSet(viewsets.ModelViewSet):
    """
    Not port-scoped: rates are company-wide. Super admin: full control. Branch manager: reads,
    and may create TODAY's rate only (any currency the model allows) — no past or future
    dates, no edit, no delete.
    """
    branch_field = None
    queryset = ExchangeRate.objects.select_related('created_by')
    serializer_class = ExchangeRateSerializer
    permission_classes = [IsBranchStaff]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = ExchangeRateFilter
    ordering = ['-date', 'currency']

    def get_permissions(self):
        if self.action in ('update', 'partial_update', 'destroy'):
            return [IsSuperAdmin()]
        return super().get_permissions()

    def perform_create(self, serializer):
        user = self.request.user
        if user.is_branch_manager and serializer.validated_data.get('date', kabul_today()) != kabul_today():
            raise PermissionDenied('مدیر بندر فقط نرخ امروز را ثبت کرده می‌تواند.')
        serializer.save(created_by=user)


class TotalsListMixin:
    """
    Paged list plus `totals` for the whole filtered set (not just the page), computed with the
    income statement's own conversion (finance.reports.amount_totals) so the two always agree.
    """
    pagination_class = StandardPagination

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data['totals'] = self.totals(self.filter_queryset(self.get_queryset()))
        return response


class HawalaViewSet(TotalsListMixin, HistoryMixin, PortScopedQuerysetMixin, viewsets.ModelViewSet):
    """The hawala amount is money moved, not an expense; only `fee` is an expense (OPEX_HAWALA_FEE)."""
    queryset = Hawala.objects.select_related('branch', 'created_by')
    serializer_class = HawalaSerializer
    permission_classes = [IsBranchStaff]

    def totals(self, queryset):
        records = list(queryset)
        return {'amount': amount_totals(records, 'amount'), 'fee': amount_totals(records, 'fee')}
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = HawalaFilter
    search_fields = ['from_party', 'to_party', 'note']
    ordering = ['-date', '-id']

    def perform_create(self, serializer):
        require_todays_usd_rate()
        user = self.request.user
        serializer.save(created_by=user, **own_branch_kwargs(user))

    def perform_update(self, serializer):
        serializer.save(**own_branch_kwargs(self.request.user))


class OfficeExpenseViewSet(TotalsListMixin, HistoryMixin, PortScopedQuerysetMixin, viewsets.ModelViewSet):
    queryset = OfficeExpense.objects.select_related('branch', 'created_by')
    serializer_class = OfficeExpenseSerializer
    permission_classes = [IsBranchStaff]

    def totals(self, queryset):
        """All, per category, and the income statement's split: salary vs everything else."""
        records = list(queryset)
        salary = [r for r in records if r.category == OfficeExpense.Category.SALARY]
        others = [r for r in records if r.category != OfficeExpense.Category.SALARY]
        result = amount_totals(records, 'amount', group_by='category')
        result['salary'] = amount_totals(salary, 'amount')
        result['non_salary'] = amount_totals(others, 'amount')
        return result
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = OfficeExpenseFilter
    search_fields = ['person', 'bill_number', 'description']
    ordering = ['-date', '-id']

    def perform_create(self, serializer):
        require_todays_usd_rate()
        user = self.request.user
        serializer.save(created_by=user, **own_branch_kwargs(user))

    def perform_update(self, serializer):
        serializer.save(**own_branch_kwargs(self.request.user))
