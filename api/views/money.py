from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from accounts.models import Branch
from api.history import HistoryMixin
from api.permissions import IsSuperAdmin, ReadOnlyForBranch
from api.serializers.money import (Conflict, MoneyFieldTypeSerializer, MoneyVisibilitySerializer)
from api.views.config import _apply
from config.models import FieldConfig
from operations.models import MoneyFieldType, Transaction, TransactionMoneyLine


def amounts_counts(types):
    """{type id: transactions holding a non-zero amount of it}: one query for the columns, one for the lines."""
    columns = [t for t in types if t.column]
    counts = {}
    if columns:
        row = Transaction.objects.aggregate(**{t.column: Count('pk', filter=~Q(**{t.column: 0})) for t in columns})
        counts.update({t.pk: row[t.column] for t in columns})
    lines = dict(TransactionMoneyLine.objects.exclude(amount=0).values('field_type_id')
                 .annotate(n=Count('pk')).order_by().values_list('field_type_id', 'n'))
    counts.update({t.pk: lines.get(t.pk, 0) for t in types if not t.column})
    return counts


class MoneyFieldTypeViewSet(HistoryMixin, viewsets.ModelViewSet):
    """
    «مدیریت → عواید و مصارف». Every role reads the types (form labels, detail page); only the
    super admin adds, renames, reorders, (de)activates, re-classifies or deletes them.
    bulk/ saves the page's staged changes (types and visibility) all at once or not at all.
    visibility/ shows one branch × trade type with how many of its transactions use each type.
    A built-in type is never deleted (deactivate it instead); an added one only without amounts.
    """
    branch_field = None  # company-wide
    queryset = MoneyFieldType.objects.order_by('sort_order', 'code')
    serializer_class = MoneyFieldTypeSerializer
    permission_classes = [ReadOnlyForBranch]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['kind', 'is_active']
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action == 'list' and self.request.user.is_super_admin:
            context['amounts_counts'] = amounts_counts(list(self.get_queryset()))
        return context

    def perform_destroy(self, instance):
        if instance.column:
            raise Conflict(f'«{instance.name_fa}» نوع داخلی سیستم است و حذف نمی‌شود؛ آن را غیرفعال کنید.')
        used = instance.amounts_count()
        if used:
            raise Conflict(f'«{instance.name_fa}» در {used} معامله مبلغ دارد و حذف نمی‌شود؛ آن را غیرفعال کنید.')
        instance.delete()

    @action(detail=False, methods=['get'], permission_classes=[IsSuperAdmin])
    def visibility(self, request):
        """[{money_type, code, visibility, field_config, count}] of one branch × trade type (?branch=&trade_type=)."""
        scope = MoneyVisibilitySerializer(data={**request.query_params.dict(), 'rows': []})
        scope.is_valid(raise_exception=True)
        branch, trade_type = scope.validated_data['branch'], scope.validated_data['trade_type']
        if not Branch.objects.filter(pk=branch).exists():
            raise NotFound('بندر پیدا نشد.')
        rows = {row.money_type_id: row for row in FieldConfig.objects.filter(
            branch_id=branch, trade_type=trade_type, money_type__isnull=False)}
        types = list(self.get_queryset())
        in_scope = Transaction.objects.filter(branch_id=branch, trade_type=trade_type)
        columns = in_scope.aggregate(**{t.column: Count('pk', filter=~Q(**{t.column: 0})) for t in types if t.column})
        lines = dict(TransactionMoneyLine.objects.filter(transaction__in=in_scope).exclude(amount=0)
                     .values('field_type_id').annotate(n=Count('pk')).order_by().values_list('field_type_id', 'n'))
        return Response([{
            'money_type': t.pk, 'code': t.code,
            'visibility': rows[t.pk].visibility if t.pk in rows else FieldConfig.Visibility.OPTIONAL,
            'field_config': rows[t.pk].pk if t.pk in rows else None,
            'count': columns[t.column] if t.column else lines.get(t.pk, 0),
        } for t in types])

    @action(detail=False, methods=['post'], permission_classes=[IsSuperAdmin])
    def bulk(self, request):
        """
        {types: [{id, name_fa?, name_ps?, name_en?, kind?, section?, sort_order?, is_active?}],
         visibility: {branch, trade_type, all_branches, all_trade_types, rows: [{money_type, visibility}]}}
        — everything saved, or nothing (400 / 409). One history row per changed type or form row.
        """
        types_data = request.data.get('types') or []
        visibility_data = request.data.get('visibility')
        if not isinstance(types_data, list) or (visibility_data is not None and not isinstance(visibility_data, dict)):
            raise serializers.ValidationError({'detail': 'شکل درخواست درست نیست.'})
        if not types_data and not (visibility_data and visibility_data.get('rows')):
            raise serializers.ValidationError({'detail': 'هیچ تغییری فرستاده نشده است.'})
        changed = 0
        with transaction.atomic():
            for item in types_data:
                if not isinstance(item, dict):
                    raise serializers.ValidationError({'detail': 'شکل درخواست درست نیست.'})
                instance = MoneyFieldType.objects.select_for_update().filter(pk=item.get('id')).first()
                if instance is None:
                    raise serializers.ValidationError({'detail': 'بعضی انواع پیدا نشد؛ صفحه را تازه کنید.'})
                data = {key: value for key, value in item.items() if key != 'id'}
                serializer = MoneyFieldTypeSerializer(instance, data=data, partial=True,
                                                      context=self.get_serializer_context())
                try:
                    serializer.is_valid(raise_exception=True)
                except serializers.ValidationError as exc:
                    raise serializers.ValidationError({'detail': f'«{instance.name_fa}»: {_first(exc.detail)}',
                                                       'type': instance.pk})
                if any(getattr(instance, name) != value for name, value in serializer.validated_data.items()):
                    serializer.save()
                    changed += 1
            if visibility_data:
                changed += self._apply_visibility(visibility_data)
        return Response({'changed': changed})

    @staticmethod
    def _apply_visibility(data):
        scope = MoneyVisibilitySerializer(data=data)
        scope.is_valid(raise_exception=True)
        values = scope.validated_data
        branches = (list(Branch.objects.values_list('pk', flat=True)) if values['all_branches']
                    else [values['branch']])
        trade_types = Transaction.TradeType.values if values['all_trade_types'] else [values['trade_type']]
        types = MoneyFieldType.objects.in_bulk([row['money_type'] for row in values['rows']])
        changed = 0
        for row in values['rows']:
            money_type = types.get(row['money_type'])
            if money_type is None:
                raise serializers.ValidationError({'detail': 'بعضی انواع پیدا نشد؛ صفحه را تازه کنید.'})
            existing = {(r.branch_id, r.trade_type): r for r in FieldConfig.objects.select_for_update().filter(
                money_type=money_type, branch_id__in=branches, trade_type__in=trade_types)}
            for branch_id in branches:
                for trade_type in trade_types:
                    config = existing.get((branch_id, trade_type)) or FieldConfig(
                        branch_id=branch_id, trade_type=trade_type, field_name=money_type.source,
                        field_label_fa=money_type.name_fa, sort_order=money_type.sort_order, money_type=money_type)
                    try:
                        changed += _apply(config, {'visibility': row['visibility']})
                    except DjangoValidationError as exc:
                        raise serializers.ValidationError({'detail': exc.messages[0], 'type': money_type.pk})
        return changed


def _first(detail):
    """The first message of a DRF error detail (dict / list / string)."""
    while isinstance(detail, (dict, list)):
        detail = next(iter(detail.values())) if isinstance(detail, dict) else detail[0]
    return str(detail)
