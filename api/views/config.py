from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.db.models import Count, Q
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import serializers, status, views, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import Branch
from api.history import HistoryMixin
from api.permissions import IsBranchStaff, IsSuperAdmin
from api.serializers import (FieldConfigBulkRowSerializer, FieldConfigCopySerializer, FieldConfigScopeSerializer,
                             FieldConfigSerializer, FormConfigSerializer)
from config.management.commands.seed_field_config import default_field_configs
from config.models import FieldConfig, configurable_transaction_fields
from kabulcargo_backend.utils import normalize_digits
from operations.models import Transaction


def _apply(row, values):
    """
    Set `values` on a FieldConfig and save it — one history row — only when it is new or
    something changed. The model's clean() (locked fields) runs first. Returns True if saved.
    """
    changed = [name for name, value in values.items() if getattr(row, name) != value]
    if row.pk is not None and not changed:
        return False
    for name in changed:
        setattr(row, name, values[name])
    row.full_clean(validate_unique=False)
    row.save()
    return True


def _has_value(field):
    """Q: a transaction holds something in `field` (not blank / null / zero / False)."""
    if field.is_relation:
        return Q(**{f'{field.name}__isnull': False})
    if isinstance(field, models.BooleanField):
        return Q(**{field.name: True})
    if isinstance(field, (models.DecimalField, models.IntegerField)):
        return ~Q(**{field.name: 0})
    if isinstance(field, (models.CharField, models.TextField)):
        return ~Q(**{field.name: ''})
    return Q(pk__isnull=False)


class FieldConfigViewSet(HistoryMixin, viewsets.ModelViewSet):
    """
    Rows of one branch × trade type (?branch=&trade_type=). A branch manager reads their own
    branch's; every write is the super admin's: one row (PATCH <id>/), a whole table at once
    (PATCH bulk/), copy/ to another branch or trade type (or every other branch), reset/ to the
    FIELD_SPEC defaults. usage/ counts the transactions holding a value per field, so the page
    can warn before a field with data is hidden. Every changed row writes its own history row.
    """
    queryset = FieldConfig.objects.select_related('branch')
    serializer_class = FieldConfigSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['branch', 'trade_type', 'visibility']

    def get_permissions(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS') and self.action != 'usage':
            return [IsBranchStaff()]
        return [IsSuperAdmin()]

    @action(detail=False, methods=['patch'])
    def bulk(self, request):
        """[{id, visibility, sort_order}, ...] of one branch × trade type — all saved or none."""
        if not isinstance(request.data, list) or not request.data:
            raise serializers.ValidationError({'detail': 'فهرست تغییرات خالی است.'})
        rows = FieldConfigBulkRowSerializer(data=request.data, many=True)
        rows.is_valid(raise_exception=True)
        ids = [row['id'] for row in rows.validated_data]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({'detail': 'یک ردیف دو بار فرستاده شده است.'})
        with transaction.atomic():
            objects = {obj.pk: obj for obj in FieldConfig.objects.select_for_update().filter(pk__in=ids)}
            if len(objects) != len(ids):
                raise serializers.ValidationError({'detail': 'بعضی ردیف‌ها پیدا نشد؛ صفحه را تازه کنید.'})
            if len({(obj.branch_id, obj.trade_type) for obj in objects.values()}) != 1:
                raise serializers.ValidationError(
                    {'detail': 'همهٔ ردیف‌ها باید از یک بندر و یک نوع معامله باشند.'})
            errors, changed = {}, 0
            for row in rows.validated_data:
                obj = objects[row['id']]
                try:
                    changed += _apply(obj, {'visibility': row['visibility'], 'sort_order': row['sort_order']})
                except DjangoValidationError as exc:
                    errors[obj.field_name] = exc.messages
            if errors:
                transaction.set_rollback(True)
                return Response({'detail': next(iter(errors.values()))[0], 'fields': errors},
                                status=status.HTTP_400_BAD_REQUEST)
        saved = FieldConfig.objects.filter(pk__in=ids)
        return Response({'changed': changed, 'rows': FieldConfigSerializer(saved, many=True).data})

    @action(detail=False, methods=['post'])
    def copy(self, request):
        """Visibility and order of every field: source branch × type → one branch, or all others."""
        data = FieldConfigCopySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        target_type = values['target_trade_type']
        source = FieldConfig.objects.filter(branch=values['source_branch'],
                                            trade_type=values['source_trade_type'])
        targets = (list(Branch.objects.exclude(pk=values['source_branch'].pk)) if values['all_branches']
                   else [values['target_branch']])
        changed = 0
        with transaction.atomic():
            for branch in targets:
                existing = {row.field_name: row for row in FieldConfig.objects.select_for_update().filter(
                    branch=branch, trade_type=target_type)}
                for src in source:
                    row = existing.get(src.field_name) or FieldConfig(
                        branch=branch, trade_type=target_type, field_name=src.field_name,
                        field_label_fa=src.field_label_fa)
                    changed += _apply(row, {'visibility': src.visibility, 'sort_order': src.sort_order})
        return Response({'changed': changed, 'branches': len(targets)})

    @action(detail=False, methods=['post'])
    def reset(self, request):
        """Back to the seed defaults (FIELD_SPEC + trade-type overrides) for one branch × trade type."""
        data = FieldConfigScopeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        branch, trade_type = data.validated_data['branch'], data.validated_data['trade_type']
        changed = 0
        with transaction.atomic():
            existing = {row.field_name: row for row in FieldConfig.objects.select_for_update().filter(
                branch=branch, trade_type=trade_type)}
            for row_type, name, defaults in default_field_configs():
                if row_type == trade_type:
                    row = existing.get(name) or FieldConfig(branch=branch, trade_type=trade_type, field_name=name)
                    changed += _apply(row, defaults)
        return Response({'changed': changed})

    @action(detail=False, methods=['get'])
    def usage(self, request):
        """{field_name: how many of this branch × trade type's transactions hold a value in it}."""
        data = FieldConfigScopeSerializer(data=request.query_params)
        data.is_valid(raise_exception=True)
        fields = {f.name: f for f in Transaction._meta.concrete_fields}
        counts = Transaction.objects.filter(
            branch=data.validated_data['branch'], trade_type=data.validated_data['trade_type'],
        ).aggregate(**{name: Count('pk', filter=_has_value(fields[name]))
                       for name, _ in configurable_transaction_fields()})
        return Response(counts)

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
