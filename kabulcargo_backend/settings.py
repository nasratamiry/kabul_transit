"""
Kabul Cargo — Django settings.

All secrets come from .env via python-decouple. Nothing secret is hardcoded here.
"""
from datetime import timedelta
from pathlib import Path

from decouple import Csv, config

from kabulcargo_backend import branding

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost', cast=Csv())


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    'jazzmin',  # must come before django.contrib.admin
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'django_filters',
    'simple_history',
    'corsheaders',
    'django_jalali',
    'axes',
    'csp',

    'kabulcargo_backend',  # project-wide management commands (backup_db, rotate_secret_key)
    'accounts',
    'partners',
    'operations',
    'finance',
    'config',
    'api',
]

# NOTE: LocaleMiddleware is intentionally absent so the admin stays Dari
# regardless of the visitor's browser language.
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'kabulcargo_backend.security.KabulCSPMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'simple_history.middleware.HistoryRequestMiddleware',
    'axes.middleware.AxesMiddleware',  # must stay last
]

ROOT_URLCONF = 'kabulcargo_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'kabulcargo_backend.context_processors.branding',
            ],
        },
    },
]

WSGI_APPLICATION = 'kabulcargo_backend.wsgi.application'


# ---------------------------------------------------------------------------
# Database — MySQL, utf8mb4
# ---------------------------------------------------------------------------
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': config('DB_NAME'),
        'USER': config('DB_USER'),
        'PASSWORD': config('DB_PASSWORD'),
        'HOST': config('DB_HOST', default='127.0.0.1'),
        'PORT': config('DB_PORT', default='3306'),
        'OPTIONS': {
            'charset': 'utf8mb4',
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
        },
    }
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_USER_MODEL = 'accounts.User'

# Axes must come first so locked-out accounts are refused before the password is checked.
AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]


# ---------------------------------------------------------------------------
# Password validation
# ---------------------------------------------------------------------------
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# ---------------------------------------------------------------------------
# Language & time
# ---------------------------------------------------------------------------
LANGUAGE_CODE = 'fa'
TIME_ZONE = 'Asia/Kabul'
USE_I18N = True
USE_TZ = True

# Project translations — Dari labels for packages that ship none (e.g. simple-history).
LOCALE_PATHS = [BASE_DIR / 'locale']


# ---------------------------------------------------------------------------
# Static & media
# ---------------------------------------------------------------------------
STATIC_URL = 'static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
# Documents are served by /api/documents/<id>/download/ (authenticated, branch-checked). Empty:
# Django streams the file. Production sets an nginx `internal` location prefix instead.
DOCUMENT_X_ACCEL_PREFIX = config('DOCUMENT_X_ACCEL_PREFIX', default='')


# ---------------------------------------------------------------------------
# REST API — JWT auth, everything requires login by default
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': ['django_filters.rest_framework.DjangoFilterBackend'],
    'COERCE_DECIMAL_TO_STRING': True,
    'EXCEPTION_HANDLER': 'api.exceptions.kabul_exception_handler',
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.AnonRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'user': '100/minute',
        'anon': '20/minute',
    },
    # DRF trusts X-Forwarded-For by default (NUM_PROXIES=None), which lets anyone
    # dodge the anon throttle by faking the header. Same rule as client_ip().
    'NUM_PROXIES': config('TRUSTED_PROXY_COUNT', default=0, cast=int),
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=config('JWT_ACCESS_MINUTES', default=60, cast=int)),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=config('JWT_REFRESH_DAYS', default=7, cast=int)),
    'AUTH_HEADER_TYPES': ('Bearer',),
}

CORS_ALLOWED_ORIGINS = config('CORS_ALLOWED_ORIGINS', default='http://localhost:5173', cast=Csv())


# ---------------------------------------------------------------------------
# Admin (Jazzmin) — Dari, Kabul Cargo branding
# ---------------------------------------------------------------------------
JAZZMIN_SETTINGS = {
    'site_title': 'سیستم مدیریت کابل کارگو',
    'site_header': 'سیستم مدیریت کابل کارگو',
    'site_brand': 'سیستم مدیریت کابل کارگو',
    'site_logo': branding.LOGO_STATIC_PATH,
    'login_logo': branding.LOGO_STATIC_PATH,
    'welcome_sign': 'به سیستم مدیریت کابل کارگو خوش آمدید',
    'copyright': 'شرکت کابل کارگو — بارچلانی و ترانزیت بین‌المللی',
    'language_chooser': False,
    'search_model': ['accounts.User', 'accounts.Branch'],
    'user_avatar': None,
    'topmenu_links': [
        {'name': 'صفحه اصلی', 'url': 'admin:index'},
    ],
    'show_sidebar': True,
    'navigation_expanded': True,
    'order_with_respect_to': ['accounts', 'accounts.Branch', 'accounts.User', 'auth'],
    'icons': {
        'accounts.Branch': 'fas fa-warehouse',
        'accounts.User': 'fas fa-user-tie',
        'auth.Group': 'fas fa-users',
    },
    'default_icon_parents': 'fas fa-folder',
    'default_icon_children': 'fas fa-circle',
    # Related-object modals load admin pages in an iframe, which X-Frame-Options
    # DENY (below) blocks; plain popup windows are used instead.
    'related_modal_active': False,
    # Jazzmin only accepts Bootstrap class names below; the exact brand hex
    # values from branding.py are applied on top by this stylesheet.
    'custom_css': 'admin_custom/kabulcargo.css',
    'show_ui_builder': False,
    'changeform_format': 'horizontal_tabs',
}

JAZZMIN_UI_TWEAKS = {
    'navbar': 'navbar-white navbar-light',  # site header is white
    'sidebar': 'sidebar-dark-primary',      # recoloured to branding.PRIMARY
    'brand_colour': 'navbar-white',         # logo area white, like the site header
    'accent': 'accent-primary',
    'no_navbar_border': False,
    'sidebar_nav_child_indent': True,
    'theme': 'default',
    'button_classes': {
        'primary': 'btn-primary',
        'secondary': 'btn-secondary',
        'info': 'btn-info',
        'warning': 'btn-warning',
        'danger': 'btn-danger',
        'success': 'btn-success',
    },
}


# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
# Reverse proxies in front of Django (nginx = 1). Only then is X-Forwarded-For
# trusted, and only the hop our proxy added — see security.client_ip().
TRUSTED_PROXY_COUNT = config('TRUSTED_PROXY_COUNT', default=0, cast=int)

# Production only (settings_production.py sets these unconditionally).
if not DEBUG:
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
# (SECURE_BROWSER_XSS_FILTER was removed in Django 4.0 and the X-XSS-Protection
# header is obsolete in browsers; CSP below replaces it.)

# Content Security Policy (django-csp 4 format). /admin/ gets a small, documented
# exception in security.KabulCSPMiddleware.
CONTENT_SECURITY_POLICY = {
    'DIRECTIVES': {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],  # Jazzmin inline styles
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
    },
}

# Account lockout (django-axes): 5 failures → locked for 15 minutes, per
# username and, separately, per IP. A super admin unlocks from the admin
# (Axes → Access attempts → delete).
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 0.25  # hours = 15 minutes
AXES_LOCKOUT_PARAMETERS = ['username', 'ip_address']
AXES_RESET_ON_SUCCESS = True
AXES_LOCKOUT_CALLABLE = 'api.views.auth.lockout_response'
AXES_CLIENT_IP_CALLABLE = 'kabulcargo_backend.security.client_ip'

# Login rate limit (django-ratelimit, failed attempts only — see api/views/auth.py).
RATELIMIT_IP_META_KEY = 'kabulcargo_backend.security.client_ip'
LOGIN_FAILURE_RATE = '5/m'

# Throttle and rate-limit counters. One process in development; production
# needs a shared cache (settings_production.py).
CACHES = {
    'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'kabulcargo'},
}

# Backups (python manage.py backup_db)
BACKUP_DIR = BASE_DIR / 'backups'
BACKUP_KEEP_DAYS = 30
MYSQLDUMP_PATH = config('MYSQLDUMP_PATH', default='')


# ---------------------------------------------------------------------------
# Logging — security events go to logs/security.log (rotated, 5 × 10 MB)
# ---------------------------------------------------------------------------
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'security': {
            'format': '{asctime} [{levelname}] {name}: {message}',
            'style': '{',
        },
    },
    'handlers': {
        'security_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': LOG_DIR / 'security.log',
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 5,
            'formatter': 'security',
            'encoding': 'utf-8',
        },
    },
    'loggers': {
        'kabulcargo.security': {
            'handlers': ['security_file'],
            'level': 'INFO',
            'propagate': False,
        },
        # django-axes' own messages (failures, lockouts; it masks usernames and IPs)
        'axes': {
            'handlers': ['security_file'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
