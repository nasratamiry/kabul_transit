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
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'simple_history.middleware.HistoryRequestMiddleware',
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
    'related_modal_active': True,
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
