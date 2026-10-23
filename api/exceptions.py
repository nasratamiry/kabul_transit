from rest_framework.response import Response
from rest_framework.views import exception_handler

from finance.utils import TodayRateMissing


def kabul_exception_handler(exc, context):
    # Daily-rate soft lock → HTTP 428
    if isinstance(exc, TodayRateMissing):
        return Response(
            {'detail': TodayRateMissing.detail_fa, 'code': TodayRateMissing.code},
            status=428,
        )
    return exception_handler(exc, context)
