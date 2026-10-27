"""
Production settings. Use with:
    DJANGO_SETTINGS_MODULE=kabulcargo_backend.settings_production

Everything below is mandatory in production and does not depend on .env's
DEBUG value. Required in the environment / .env: SECRET_KEY (50+ chars),
ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS, ADMIN_URL (not admin/), DB_*. Optional: TRUSTED_PROXY_COUNT
(1 behind nginx; 2 in docker-compose: TLS proxy → nginx), CSRF_TRUSTED_ORIGINS, REDIS_URL
(required by docker-compose.yml). KC_LOCAL_HTTP_TEST is for a local test of the Docker stack
only and is refused for any real host name.
"""
from decouple import Csv, config
from django.core.exceptions import ImproperlyConfigured

from .settings import *  # noqa: F401,F403
from .settings import ADMIN_URL, LOGGING, REST_FRAMEWORK, SECRET_KEY

DEBUG = False

# The Django admin must live at a secret path of its own: /admin/... belongs to the React app
# (nginx sends ADMIN_URL to Django and everything else to the app), and the other prefixes are
# the API's and the files'.
if ADMIN_URL.split('/')[0] in ('admin', 'api', 'static', 'assets', 'media', 'protected-media', ''):
    raise ImproperlyConfigured('ADMIN_URL must be a path of its own in production, e.g. "kc-panel-7f3a/" '
                               '(not admin/, api/, static/, assets/ or media/).')
ALLOWED_HOSTS = config('ALLOWED_HOSTS', cast=Csv())
if not ALLOWED_HOSTS or '*' in ALLOWED_HOSTS:
    raise ImproperlyConfigured('ALLOWED_HOSTS must list the real domain names in production (no "*").')

# Strong SECRET_KEY: long, and not one of the placeholders.
if len(SECRET_KEY) < 50 or SECRET_KEY.startswith('django-insecure') or 'put-a-long-random' in SECRET_KEY:
    raise ImproperlyConfigured('SECRET_KEY must be at least 50 chars in production '
                               '(python manage.py rotate_secret_key makes one).')

# HTTPS everywhere
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000  # one year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_REFERRER_POLICY = 'same-origin'
CSRF_TRUSTED_ORIGINS = config('CSRF_TRUSTED_ORIGINS', default='', cast=Csv())

# Local test of the production stack over plain HTTP (docker compose on a developer machine,
# no certificate). Only for localhost: with any real domain in ALLOWED_HOSTS the server refuses
# to start, so the flag cannot stay switched on in a real deployment.
LOCAL_HTTP_TEST = config('KC_LOCAL_HTTP_TEST', default=False, cast=bool)
if LOCAL_HTTP_TEST:
    if set(ALLOWED_HOSTS) - {'localhost', '127.0.0.1'}:
        raise ImproperlyConfigured('KC_LOCAL_HTTP_TEST is only for a local test (ALLOWED_HOSTS=localhost,127.0.0.1). '
                                   'Remove it in a real deployment.')
    SECURE_SSL_REDIRECT = False
    SECURE_HSTS_SECONDS = 0
    SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_PRELOAD = False
    SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = False

# Strict CORS: only the listed frontend origins.
CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', cast=Csv())
CORS_ALLOW_ALL_ORIGINS = False

# Document files: Django checks login + branch, nginx sends the bytes from an `internal`
# location (deploy/nginx/default.conf). /media/ itself must not be public in production.
DOCUMENT_X_ACCEL_PREFIX = config('DOCUMENT_X_ACCEL_PREFIX', default='/protected-media')

# The browsable API is a developer tool; production serves JSON only.
REST_FRAMEWORK = {**REST_FRAMEWORK, 'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer']}

# Throttle / rate-limit counters must be shared by all worker processes.
# Redis is best (pip install redis). Without it, the database cache works but
# its counters are not atomic, so under heavy parallel load a limit can be
# exceeded slightly; axes' lockout (stored in MySQL) still holds exactly.
# Create the table once: python manage.py createcachetable
REDIS_URL = config('REDIS_URL', default='')
if REDIS_URL:
    CACHES = {'default': {'BACKEND': 'django.core.cache.backends.redis.RedisCache', 'LOCATION': REDIS_URL}}
else:
    CACHES = {'default': {'BACKEND': 'django.core.cache.backends.db.DatabaseCache', 'LOCATION': 'kabulcargo_cache'}}

# Errors, warnings and the security events also go to stdout/stderr, where docker collects and
# rotates them. (logs/security.log stays as well; with several gunicorn workers its own size-based
# rotation is per process, so the docker log is the complete copy.)
LOGGING = {
    **LOGGING,
    'handlers': {**LOGGING['handlers'], 'console': {'class': 'logging.StreamHandler', 'formatter': 'security'}},
    'loggers': {
        **{name: {**logger, 'handlers': [*logger['handlers'], 'console']} for name, logger in LOGGING['loggers'].items()},
        'django': {'handlers': ['console'], 'level': 'WARNING'},
    },
}
