from datetime import timedelta

from django.utils import timezone
from rest_framework import status, views, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.models import Branch
from api.filters import parse_any_date
from api.excel import income_statement_workbook, xlsx_response
from api.permissions import IsBranchStaff, IsSuperAdmin
from api.serializers import StatementLineSerializer
from finance.models import StatementLine
from finance.dashboard import dashboard_summary
from finance.reports import income_statement
from kabulcargo_backend.security import log_event
from kabulcargo_backend.utils import dual_date, normalize_digits

MAX_RANGE = timedelta(days=731)  # two years (one may be a leap year)


def _bad_request(detail):
    return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)


class _BadParams(Exception):
    def __init__(self, response):
        self.response = response


def report_params(request, dates=True):
    """
    Branch (and period) of a report request, with the same rules everywhere: a branch
    manager always gets their own branch (another requested branch → warning); a super
    admin gets one branch or, without `branch`, all. Dates: Shamsi or Gregorian, Dari or
    English digits; both or neither (neither = the current Shamsi month). Raises _BadParams.
    """
    params = request.query_params
    warnings = []
    date_from = date_to = None
    if dates:
        raw_from, raw_to = params.get('date_from'), params.get('date_to')
        if bool(raw_from) != bool(raw_to):
            raise _BadParams(_bad_request('هر دو تاریخ (date_from و date_to) را بدهید، یا هیچ‌کدام را (ماه جاری).'))
        if raw_from:
            try:
                date_from, date_to = parse_any_date(raw_from), parse_any_date(raw_to)
            except (TypeError, ValueError):
                raise _BadParams(_bad_request('تاریخ نامعتبر است. شکل درست: ۱۴۰۵-۰۷-۰۱ یا 2026-09-23'))
            if date_from > date_to:
                raise _BadParams(_bad_request('date_from نباید بعد از date_to باشد.'))
            if date_to.togregorian() - date_from.togregorian() > MAX_RANGE:
                raise _BadParams(_bad_request('بازهٔ گزارش نمی‌تواند بیشتر از دو سال باشد.'))

    user = request.user
    requested = normalize_digits(params.get('branch') or '')
    if requested and not requested.isdigit():
        raise _BadParams(_bad_request('پارامتر branch باید عدد باشد.'))
    if user.is_branch_manager:
        branch_id = user.branch_id
        if requested and int(requested) != branch_id:
            warnings.append('شما فقط گزارش بندر خود را می‌بینید؛ بندر خواسته‌شده نادیده گرفته شد.')
    else:
        branch_id = int(requested) if requested else None
        if branch_id and not Branch.objects.filter(pk=branch_id).exists():
            raise _BadParams(Response({'detail': 'بندر پیدا نشد.'}, status=status.HTTP_404_NOT_FOUND))
    return branch_id, date_from, date_to, warnings


def _statement(request):
    branch_id, date_from, date_to, warnings = report_params(request)
    report = income_statement(branch_id=branch_id, date_from=date_from, date_to=date_to)
    report['warnings'] = warnings + report['warnings']
    report['generated_at'] = dual_date(timezone.now())
    return report


class IncomeStatementView(views.APIView):
    """
    GET /api/income-statement/?branch=&date_from=&date_to=
    Dates: Shamsi or Gregorian, Dari or English digits; both or neither
    (neither = the current Shamsi month). A branch manager always gets their
    own branch; a super admin gets one branch or, without `branch`, all branches.
    """
    permission_classes = [IsBranchStaff]

    def get(self, request):
        try:
            return Response(_statement(request))
        except _BadParams as bad:
            return bad.response


class IncomeStatementExportView(views.APIView):
    """GET /api/income-statement/export/ — the same report (same params and scoping) as .xlsx."""
    permission_classes = [IsBranchStaff]

    def get(self, request):
        try:
            report = _statement(request)
        except _BadParams as bad:
            return bad.response
        branch = report['branch']['name'] if report['branch'] else 'همهٔ بندرها'
        content = income_statement_workbook(report, branch)
        period = report['period']
        log_event('export', request, kind='income_statement', branch=report['branch'] and report['branch']['id'],
                  period=f'{period["from"]}..{period["to"]}')
        return xlsx_response(content, f'income-statement_{period["from"]}_{period["to"]}.xlsx')


class DashboardSummaryView(views.APIView):
    """
    GET /api/dashboard/summary/?branch= — this Shamsi month vs the previous one (from the
    income statement service), daily net profit, top traders, recent transactions, today's
    rate; a super admin without `branch` also gets one comparison row per branch.
    """
    permission_classes = [IsBranchStaff]

    def get(self, request):
        try:
            branch_id, _, _, warnings = report_params(request, dates=False)
        except _BadParams as bad:
            return bad.response
        summary = dashboard_summary(branch_id, compare_branches=request.user.is_super_admin)
        summary['warnings'] = warnings + summary['warnings']
        summary['branch'] = branch_id
        summary['generated_at'] = dual_date(timezone.now())
        return Response(summary)


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
