from axes.handlers.proxy import AxesProxyHandler
from django.conf import settings
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.http import HttpResponse, JsonResponse
from django_ratelimit.core import get_usage
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from api.serializers import MeSerializer
from kabulcargo_backend.security import log_event

ACCOUNT_LOCKED_FA = 'حساب شما به دلیل تلاش‌های ناموفق زیاد برای ۱۵ دقیقه قفل شد. بعداً کوشش کنید یا با سوپر ادمین تماس بگیرید.'
TOO_MANY_LOGINS_FA = 'تلاش‌های ناموفق ورود زیاد است. لطفاً {seconds} ثانیه بعد دوباره کوشش کنید.'


def lockout_response(request, original_response=None, credentials=None):
    """AXES_LOCKOUT_CALLABLE: HTTP 423. JSON for the API, a short Dari page elsewhere (admin)."""
    log_event('account_locked', request, username=(credentials or {}).get('username'))
    if request.path.startswith('/api/'):
        return JsonResponse({'detail': ACCOUNT_LOCKED_FA, 'code': 'ACCOUNT_LOCKED'}, status=423)
    return HttpResponse(f'<p dir="rtl" style="font-family:Vazirmatn,sans-serif">{ACCOUNT_LOCKED_FA}</p>',
                        status=423)


def _failed_login_usage(request, increment=False):
    # Counts failed logins per client IP (security.client_ip). Successful logins are never counted.
    return get_usage(request, group='api-login-failures', key='ip', rate=settings.LOGIN_FAILURE_RATE,
                     increment=increment)


class KabulTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['role'] = user.role
        token['branch_id'] = user.branch_id
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = MeSerializer(self.user).data
        return data


class LoginView(TokenObtainPairView):
    """
    JWT login with two brute-force guards:
    - more than LOGIN_FAILURE_RATE failed logins per minute from one IP (one office) → 429
      TOO_MANY_LOGIN_ATTEMPTS;
    - 5 failures for one username → axes locks that account for 15 min → 423 ACCOUNT_LOCKED.
    simplejwt never sends user_logged_in, so it is sent here; that is what lets
    axes reset on success, updates last_login, and writes the security log.
    """
    serializer_class = KabulTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        django_request = request._request
        usage = _failed_login_usage(django_request)
        if usage and usage['count'] >= usage['limit']:
            log_event('login_rate_limited', django_request, username=request.data.get('username'))
            return Response(
                {'detail': TOO_MANY_LOGINS_FA.format(seconds=usage['time_left']), 'code': 'TOO_MANY_LOGIN_ATTEMPTS'},
                status=status.HTTP_429_TOO_MANY_REQUESTS, headers={'Retry-After': str(usage['time_left'])},
            )

        credentials = {'username': request.data.get('username')}
        if AxesProxyHandler.is_locked(django_request, credentials):
            return lockout_response(django_request, None, credentials)

        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except AuthenticationFailed:
            _failed_login_usage(django_request, increment=True)
            if AxesProxyHandler.is_locked(django_request, credentials):  # this failure was the 5th
                return lockout_response(django_request, None, credentials)
            raise

        user_logged_in.send(sender=serializer.user.__class__, request=django_request, user=serializer.user)
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(MeSerializer(request.user).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout(request):
    try:
        token = request.data.get('refresh')
        if token:
            RefreshToken(token).blacklist()
    except Exception:
        pass
    user_logged_out.send(sender=request.user.__class__, request=request._request, user=request.user)
    return Response({'detail': 'خروج موفق'}, status=status.HTTP_200_OK)
