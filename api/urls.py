from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from api.views import accounts, auth, config, finance, operations, partners

router = DefaultRouter()
router.register('branches', accounts.BranchViewSet, basename='branch')
router.register('users', accounts.UserViewSet, basename='user')
router.register('traders', partners.TraderViewSet, basename='trader')
router.register('transport-companies', partners.TransportCompanyViewSet, basename='transport-company')
router.register('transactions', operations.TransactionViewSet, basename='transaction')
router.register('documents', operations.DocumentViewSet, basename='document')
router.register('exchange-rates', finance.ExchangeRateViewSet, basename='exchange-rate')
router.register('hawala', finance.HawalaViewSet, basename='hawala')
router.register('office-expenses', finance.OfficeExpenseViewSet, basename='office-expense')
router.register('field-configs', config.FieldConfigViewSet, basename='field-config')

urlpatterns = [
    path('auth/login/', auth.LoginView.as_view(), name='api_login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='api_refresh'),
    path('auth/logout/', auth.logout, name='api_logout'),
    path('auth/me/', auth.me, name='api_me'),
    path('form-config/', config.FormConfigView.as_view(), name='api_form_config'),
    path('', include(router.urls)),
]
