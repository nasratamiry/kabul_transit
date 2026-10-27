"""
GET /api/health/ — liveness for docker-compose / Coolify / an uptime monitor.

Open to anyone and never throttled (a plain Django view, outside DRF), so it says nothing
but ok / not ok: no versions, hosts, counts or error text. The reason for a failure goes to
the security log instead.
"""
import logging

from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from kabulcargo_backend.security import log_event


def _database():
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
        return cursor.fetchone() == (1,)


def _cache():
    # The cache holds the throttle / rate-limit counters; a write that cannot be read back
    # means the limits are not enforced.
    cache.set('health-check', 'ok', 30)
    return cache.get('health-check') == 'ok'


@never_cache
@require_GET
def health(request):
    checks = {}
    for name, probe in (('database', _database), ('cache', _cache)):
        try:
            checks[name] = bool(probe())
        except Exception as exc:  # noqa: BLE001 — any failure is "not ok"
            checks[name] = False
            log_event('health_failed', check=name, error=f'{type(exc).__name__}: {exc}'[:200],
                      level=logging.ERROR)
    ok = all(checks.values())
    return JsonResponse({'status': 'ok' if ok else 'error', 'checks': checks}, status=200 if ok else 503)
