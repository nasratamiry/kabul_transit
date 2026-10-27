"""Docker HEALTHCHECK for the backend: GET /api/health/ on gunicorn directly.

Sends a Host from ALLOWED_HOSTS (Django refuses unknown hosts) and X-Forwarded-Proto: https
(otherwise the HTTPS redirect answers 301 instead of the check)."""
import os
import sys
import urllib.request

host = os.environ.get('ALLOWED_HOSTS', 'localhost').split(',')[0].strip().lstrip('.') or 'localhost'
request = urllib.request.Request('http://127.0.0.1:8000/api/health/',
                                 headers={'Host': host, 'X-Forwarded-Proto': 'https'})
try:
    with urllib.request.urlopen(request, timeout=8) as response:
        sys.exit(0 if response.status == 200 else 1)
except Exception as exc:  # noqa: BLE001
    print(f'health check failed: {exc}', file=sys.stderr)
    sys.exit(1)
