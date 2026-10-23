from django.db.models import ProtectedError
from rest_framework.exceptions import Throttled
from rest_framework.response import Response
from rest_framework.views import exception_handler

from finance.utils import TodayRateMissing
from kabulcargo_backend.security import log_event

THROTTLED_FA = 'تعداد درخواست‌ها زیاد است. لطفاً {seconds} ثانیه بعد دوباره کوشش کنید.'
PROTECTED_FA = 'حذف ممکن نیست، چون {related} به این رکورد وصل است. اول آن‌ها را جدا کنید، یا این رکورد را غیرفعال کنید.'


def kabul_exception_handler(exc, context):
    request = context.get('request')

    # Daily-rate soft lock → HTTP 428
    if isinstance(exc, TodayRateMissing):
        log_event('today_rate_missing', request)
        return Response(
            {'detail': TodayRateMissing.detail_fa, 'code': TodayRateMissing.code},
            status=428,
        )

    # API throttle → HTTP 429 with a Dari message
    if isinstance(exc, Throttled):
        seconds = int(exc.wait or 60) + 1
        log_event('throttled', request, wait=seconds)
        return Response({'detail': THROTTLED_FA.format(seconds=seconds), 'code': 'TOO_MANY_REQUESTS'},
                        status=429, headers={'Retry-After': str(seconds)})

    # Delete blocked by on_delete=PROTECT (e.g. a branch that still has users) → 409, not a 500
    if isinstance(exc, ProtectedError):
        related = '، '.join(sorted({str(obj._meta.verbose_name_plural) for obj in exc.protected_objects}))
        log_event('delete_protected', request, related=related)
        return Response({'detail': PROTECTED_FA.format(related=related), 'code': 'PROTECTED'}, status=409)

    response = exception_handler(exc, context)
    if response is not None and response.status_code == 403:
        log_event('permission_denied', request, method=getattr(request, 'method', None),
                  detail=str(response.data.get('detail', '')) if isinstance(response.data, dict) else '')
    return response
