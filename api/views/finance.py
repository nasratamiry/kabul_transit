from django.db.models import Count
from django_filters.rest_framework import CharFilter, ChoiceFilter, DjangoFilterBackend, FilterSet
from rest_framework import filters, viewsets
from rest_framework.exceptions import PermissionDenied

from api.filters import ShamsiDateFilter
from api.history import HistoryMixin
from api.mixins import PortScopedQuerysetMixin, own_branch_kwargs
from api.pagination import StandardPagination
from api.permissions import IsBranchStaff, IsSuperAdmin, ReadOnlyForBranch
from api.serializers import (ExchangeRateSerializer, HawalaSerializer, OfficeExpenseSerializer,
                             OfficeIncomeCategorySerializer, OfficeIncomeSerializer)
from finance.models import ExchangeRate, Hawala, OfficeExpense, OfficeIncome, OfficeIncomeCategory
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
    # Income-statement drill-down: OPEX_SALARY = salary, OPEX_OFFICE = everything else.
    kind = ChoiceFilter(method='filter_kind', label='معاش / غیر معاش',
                        choices=[('salary', 'معاش'), ('non_salary', 'غیر معاش')])

    class Meta:
        model = OfficeExpense
        fields = ['branch', 'category', 'currency']

    def filter_kind(self, queryset, name, value):
        salary = OfficeExpense.Category.SALARY
        return queryset.filter(category=salary) if value == 'salary' else queryset.exclude(category=salary)


class OfficeIncomeFilter(FilterSet):
    date = ShamsiDateFilter(field_name='date')
    date_from = ShamsiDateFilter(field_name='date', lookup_expr='gte')
    date_to = ShamsiDateFilter(field_name='date', lookup_expr='lte')
    # Income-statement drill-down: ?category=<code> (one «سایر عواید» line per category).
    category = CharFilter(method='filter_category', label='کتگوری (کود)')

    class Meta:
        model = OfficeIncome
        fields = ['branch', 'currency']

    def filter_category(self, queryset, name, value):
        return queryset.filter(category__code=value.strip().upper())


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


class OfficeIncomeViewSet(TotalsListMixin, HistoryMixin, PortScopedQuerysetMixin, viewsets.ModelViewSet):
    """An office's own income (both roles, own branch for a manager); «سایر عواید» of the income statement."""
    queryset = OfficeIncome.objects.select_related('branch', 'created_by', 'category')
    serializer_class = OfficeIncomeSerializer
    permission_classes = [IsBranchStaff]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = OfficeIncomeFilter
    search_fields = ['person', 'reference_number', 'note']
    ordering = ['-date', '-id']

    def totals(self, queryset):
        """All, and per category code (each one income-statement line)."""
        return amount_totals(list(queryset), 'amount', group_by='category_code')

    def perform_create(self, serializer):
        require_todays_usd_rate()
        user = self.request.user
        serializer.save(created_by=user, **own_branch_kwargs(user))

    def perform_update(self, serializer):
        serializer.save(**own_branch_kwargs(self.request.user))


class OfficeIncomeCategoryViewSet(HistoryMixin, viewsets.ModelViewSet):
    """Every role reads the categories (form, filter); only the super admin changes them. Delete needs no incomes."""
    branch_field = None  # company-wide
    queryset = OfficeIncomeCategory.objects.annotate(incomes_count=Count('incomes')).order_by('sort_order', 'code')
    serializer_class = OfficeIncomeCategorySerializer
    permission_classes = [ReadOnlyForBranch]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_active']
    pagination_class = None


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
