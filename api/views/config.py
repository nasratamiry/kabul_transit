from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, views, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import Branch
from api.permissions import IsBranchStaff, IsSuperAdmin
from api.serializers import FieldConfigSerializer, FormConfigSerializer
from config.models import FieldConfig
from kabulcargo_backend.utils import normalize_digits
from operations.models import Transaction


class FieldConfigViewSet(viewsets.ModelViewSet):
    queryset = FieldConfig.objects.select_related('branch')
    serializer_class = FieldConfigSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['branch', 'trade_type', 'visibility']

    def get_permissions(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return [IsBranchStaff()]
        return [IsSuperAdmin()]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_super_admin:
            return qs
        if user.is_branch_manager and user.branch_id:
            return qs.filter(branch_id=user.branch_id)
        return qs.none()


class FormConfigView(views.APIView):
    """GET /api/form-config/?branch=&trade_type= → dynamic form definition."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        trade_type = request.query_params.get('trade_type')
        if not trade_type:
            return Response({'detail': 'پارامتر trade_type لازم است.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if trade_type not in Transaction.TradeType.values:
            return Response({'detail': 'نوع معامله نامعتبر است.'}, status=status.HTTP_400_BAD_REQUEST)
        user = request.user
        # Branch manager cannot look at another branch
        if user.is_branch_manager:
            branch_id = user.branch_id
        else:
            branch_id = normalize_digits(request.query_params.get('branch') or '')
            if not branch_id:
                return Response({'detail': 'پارامتر branch لازم است.'},
                                status=status.HTTP_400_BAD_REQUEST)
            if not branch_id.isdigit():
                return Response({'detail': 'پارامتر branch باید عدد باشد.'},
                                status=status.HTTP_400_BAD_REQUEST)
        if not Branch.objects.filter(pk=branch_id).exists():
            return Response({'detail': 'بندر پیدا نشد.'}, status=status.HTTP_404_NOT_FOUND)
        rows = list(FieldConfig.objects.filter(branch_id=branch_id, trade_type=trade_type))
        payload = {'branch': int(branch_id), 'trade_type': trade_type, 'form_fields': rows}
        return Response(FormConfigSerializer(payload).data)
