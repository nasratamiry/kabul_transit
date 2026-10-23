from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets

from api.permissions import IsBranchStaff
from api.serializers import TraderSerializer, TransportCompanySerializer
from partners.models import Trader, TransportCompany


class TraderViewSet(viewsets.ModelViewSet):
    """Shared by every branch — not port-scoped."""
    branch_field = None
    queryset = Trader.objects.all()
    serializer_class = TraderSerializer
    permission_classes = [IsBranchStaff]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['is_active']
    search_fields = ['name', 'company_name', 'phone', 'national_id']


class TransportCompanyViewSet(viewsets.ModelViewSet):
    """Shared by every branch — not port-scoped."""
    branch_field = None
    queryset = TransportCompany.objects.all()
    serializer_class = TransportCompanySerializer
    permission_classes = [IsBranchStaff]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['is_active']
    search_fields = ['name', 'phone', 'country']
