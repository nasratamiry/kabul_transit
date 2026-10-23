from axes.helpers import get_cool_off
from axes.models import AccessAttempt
from axes.utils import reset as axes_reset
from django.conf import settings
from django.db.models import Count, Sum
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.models import Branch, User
from api.permissions import IsSuperAdmin, ReadOnlyForBranch
from api.serializers import BranchSerializer, UserSerializer
from kabulcargo_backend.security import log_event


def locked_usernames():
    """Usernames axes currently locks out: AXES_FAILURE_LIMIT failures within the cool-off window."""
    rows = (AccessAttempt.objects.filter(attempt_time__gte=timezone.now() - get_cool_off())
            .exclude(username__isnull=True).values('username')
            .annotate(failures=Sum('failures_since_start')))
    return {row['username'] for row in rows if row['failures'] >= settings.AXES_FAILURE_LIMIT}


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

    def get_serializer_context(self):
        # One query for the whole list; UserSerializer.is_locked reads it.
        context = super().get_serializer_context()
        if self.request.user.is_authenticated and self.request.user.is_super_admin:
            context['locked_usernames'] = locked_usernames()
        return context

    @action(detail=True, methods=['post'], permission_classes=[IsSuperAdmin])
    def unlock(self, request, pk=None):
        """POST /api/users/{id}/unlock/ — clear the axes lockout (failed logins) for this username."""
        user = self.get_object()
        reset_count = axes_reset(username=user.username)
        log_event('account_unlocked', request, target=user.username, reset=reset_count)
        return Response({'detail': f'حساب «{user.username}» باز شد.', 'reset': reset_count})
