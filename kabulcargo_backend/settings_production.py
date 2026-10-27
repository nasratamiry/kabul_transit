"""
Production settings. Use with:
    DJANGO_SETTINGS_MODULE=kabulcargo_backend.settings_production

Everything below is mandatory in production and does not depend on .env's
DEBUG value. Required in the environment / .env: SECRET_KEY (50+ chars),
ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS, DB_*. Optional: TRUSTED_PROXY_COUNT
(1 behind nginx), CSRF_TRUSTED_ORIGINS, REDIS_URL.
"""
from decouple import Csv, config
from django.core.exceptions import ImproperlyConfigured

from .settings import *  # noqa: F401,F403
from .settings import REST_FRAMEWORK, SECRET_KEY

DEBUG = False
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

# Strict CORS: only the listed frontend origins.
CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', cast=Csv())
CORS_ALLOW_ALL_ORIGINS = False

# Document files: Django checks login + branch, nginx sends the bytes from an `internal`
# location (deploy/nginx-documents.conf). /media/ itself must not be public in production.
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
