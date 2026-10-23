from datetime import timedelta

from django.utils import timezone
from rest_framework import status, views, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.models import Branch
from api.filters import parse_any_date
from api.permissions import IsBranchStaff, IsSuperAdmin
from api.serializers import StatementLineSerializer
from finance.models import StatementLine
from finance.reports import income_statement
from kabulcargo_backend.utils import dual_date, normalize_digits

MAX_RANGE = timedelta(days=731)  # two years (one may be a leap year)


def _bad_request(detail):
    return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)


class IncomeStatementView(views.APIView):
    """
    GET /api/income-statement/?branch=&date_from=&date_to=
    Dates: Shamsi or Gregorian, Dari or English digits; both or neither
    (neither = the current Shamsi month). A branch manager always gets their
    own branch; a super admin gets one branch or, without `branch`, all branches.
    """
    permission_classes = [IsBranchStaff]

    def get(self, request):
        params = request.query_params
        warnings = []

        raw_from, raw_to = params.get('date_from'), params.get('date_to')
        if bool(raw_from) != bool(raw_to):
            return _bad_request('هر دو تاریخ (date_from و date_to) را بدهید، یا هیچ‌کدام را (ماه جاری).')
        date_from = date_to = None
        if raw_from:
            try:
                date_from, date_to = parse_any_date(raw_from), parse_any_date(raw_to)
            except (TypeError, ValueError):
                return _bad_request('تاریخ نامعتبر است. شکل درست: ۱۴۰۵-۰۷-۰۱ یا 2026-09-23')
            if date_from > date_to:
                return _bad_request('date_from نباید بعد از date_to باشد.')
            if date_to.togregorian() - date_from.togregorian() > MAX_RANGE:
                return _bad_request('بازهٔ گزارش نمی‌تواند بیشتر از دو سال باشد.')

        user = request.user
        requested = normalize_digits(params.get('branch') or '')
        if requested and not requested.isdigit():
            return _bad_request('پارامتر branch باید عدد باشد.')
        if user.is_branch_manager:
            branch_id = user.branch_id
            if requested and int(requested) != branch_id:
                warnings.append('شما فقط گزارش بندر خود را می‌بینید؛ بندر خواسته‌شده نادیده گرفته شد.')
        else:
            branch_id = int(requested) if requested else None
            if branch_id and not Branch.objects.filter(pk=branch_id).exists():
                return Response({'detail': 'بندر پیدا نشد.'}, status=status.HTTP_404_NOT_FOUND)

        report = income_statement(branch_id=branch_id, date_from=date_from, date_to=date_to)
        report['warnings'] = warnings + report['warnings']
        report['generated_at'] = dual_date(timezone.now())
        return Response(report)


class StatementLineViewSet(viewsets.ModelViewSet):
    """Income-statement lines: super admin only. GET /api/statement-lines/{id}/history/ lists every change."""
    queryset = StatementLine.objects.all()
    serializer_class = StatementLineSerializer
    permission_classes = [IsSuperAdmin]

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        records = self.get_object().history.select_related('history_user').order_by('-history_date')
        fields = StatementLineSerializer.Meta.fields
        return Response([{
            'history_id': record.history_id,
            'type': record.get_history_type_display(),
            'date': dual_date(record.history_date),
            'user': record.history_user.get_username() if record.history_user else None,
            'values': {name: getattr(record, name) for name in fields if name != 'id'},
        } for record in records])
