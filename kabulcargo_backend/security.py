"""
Shared security helpers: one client-IP rule for every limiter, the security
logger, and the CSP middleware.
"""
import logging

from csp.middleware import CSPMiddleware
from django.conf import settings
from simple_history.models import HistoricalRecords

security_log = logging.getLogger('kabulcargo.security')


def client_ip(request):
    """
    The client's IP for rate limits, lockouts and logs.

    X-Forwarded-For is trusted only when TRUSTED_PROXY_COUNT > 0 (the app runs
    behind that many reverse proxies, e.g. nginx = 1). Each proxy appends the
    address it saw, so the real client is that many entries from the right;
    anything further left can be forged by the client and is ignored.
    """
    meta = request.META
    proxies = getattr(settings, 'TRUSTED_PROXY_COUNT', 0)
    if proxies:
        hops = [hop.strip() for hop in meta.get('HTTP_X_FORWARDED_FOR', '').split(',') if hop.strip()]
        if len(hops) >= proxies:
            return hops[-proxies]
    return meta.get('REMOTE_ADDR') or '0.0.0.0'


def current_request():
    """The request being handled, if any (set by simple-history's HistoryRequestMiddleware)."""
    return getattr(HistoricalRecords.context, 'request', None)


def log_event(event, request=None, level=logging.INFO, **fields):
    """
    Write one line to logs/security.log: the event name, then key=value pairs.
    Values are repr()-quoted so user input (usernames, paths) cannot inject
    fake log lines.
    """
    if request is not None:
        user = getattr(request, 'user', None)
        fields = {
            'ip': client_ip(request),
            'actor': user.get_username() if user is not None and user.is_authenticated else None,
            'path': request.path,
            'ua': request.META.get('HTTP_USER_AGENT', '')[:200],
            **fields,
        }
    details = ' '.join(f'{key}={value!r}' for key, value in fields.items())
    security_log.log(level, f'{event} {details}'.strip())


class KabulCSPMiddleware(CSPMiddleware):
    """
    Strict CSP from settings.CONTENT_SECURITY_POLICY everywhere, with one
    deliberate exception for /admin/: Jazzmin hard-codes two inline scripts
    (theme switcher, list-filter setup) and loads Google Fonts, and those can't
    be given a nonce without forking Jazzmin's base template. The admin is
    super-admin only and Django escapes all output, so allowing inline scripts
    there is a contained risk. The API and everything else stay strict.
    """
    ADMIN_EXTRA = {
        'script-src': ["'unsafe-inline'"],
        'style-src': ['https://fonts.googleapis.com'],
        'font-src': ['https://fonts.gstatic.com'],
    }

    def get_policy_parts(self, request, response, report_only=False):
        parts = super().get_policy_parts(request, response, report_only)
        if not report_only and request.path_info.startswith('/admin/'):
            parts.update = {**(parts.update or {}), **self.ADMIN_EXTRA}
        return parts
