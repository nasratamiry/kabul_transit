from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from api.views import accounts, auth, config, finance, health, money, operations, partners, reports

router = DefaultRouter()
router.register('branches', accounts.BranchViewSet, basename='branch')
router.register('users', accounts.UserViewSet, basename='user')
router.register('traders', partners.TraderViewSet, basename='trader')
router.register('transport-companies', partners.TransportCompanyViewSet, basename='transport-company')
router.register('transactions', operations.TransactionViewSet, basename='transaction')
router.register('documents', operations.DocumentViewSet, basename='document')
router.register('document-types', operations.DocumentTypeViewSet, basename='document-type')
router.register('document-requirements', operations.DocumentRequirementViewSet,
                basename='document-requirement')
router.register('exchange-rates', finance.ExchangeRateViewSet, basename='exchange-rate')
router.register('hawala', finance.HawalaViewSet, basename='hawala')
router.register('office-expenses', finance.OfficeExpenseViewSet, basename='office-expense')
router.register('office-incomes', finance.OfficeIncomeViewSet, basename='office-income')
router.register('office-income-categories', finance.OfficeIncomeCategoryViewSet,
                basename='office-income-category')
router.register('money-types', money.MoneyFieldTypeViewSet, basename='money-type')
router.register('field-configs', config.FieldConfigViewSet, basename='field-config')
router.register('statement-lines', reports.StatementLineViewSet, basename='statement-line')

urlpatterns = [
    path('health/', health.health, name='api_health'),
    path('auth/login/', auth.LoginView.as_view(), name='api_login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='api_refresh'),
    path('auth/logout/', auth.logout, name='api_logout'),
    path('auth/me/', auth.me, name='api_me'),
    path('form-config/', config.FormConfigView.as_view(), name='api_form_config'),
    path('income-statement/', reports.IncomeStatementView.as_view(), name='api_income_statement'),
    path('income-statement/export/', reports.IncomeStatementExportView.as_view(), name='api_income_statement_export'),
    path('dashboard/summary/', reports.DashboardSummaryView.as_view(), name='api_dashboard_summary'),
    path('', include(router.urls)),
]
