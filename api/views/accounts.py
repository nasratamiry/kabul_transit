from django.db.models import Count
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets

from accounts.models import Branch, User
from api.permissions import ReadOnlyForBranch
from api.serializers import BranchSerializer, UserSerializer


class BranchViewSet(viewsets.ModelViewSet):
    """Super admin: full access. Branch manager: reads only their own branch."""
    serializer_class = BranchSerializer
    permission_classes = [ReadOnlyForBranch]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['is_active']
    search_fields = ['name', 'code', 'city']

    def get_queryset(self):
        qs = Branch.objects.annotate(user_count=Count('users'))
        user = self.request.user
        if user.is_super_admin:
            return qs
        if user.is_branch_manager and user.branch_id:
            return qs.filter(pk=user.branch_id)
        return qs.none()


class UserViewSet(viewsets.ModelViewSet):
    """Super admin manages every user. Branch manager can only read their own record."""
    serializer_class = UserSerializer
    permission_classes = [ReadOnlyForBranch]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['role', 'branch', 'is_active']
    search_fields = ['username', 'first_name', 'last_name', 'phone']

    def get_queryset(self):
        qs = User.objects.select_related('branch').order_by('username')
        user = self.request.user
        if user.is_super_admin:
            return qs
        return qs.filter(pk=user.pk)
