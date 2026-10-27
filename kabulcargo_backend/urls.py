from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path


def _super_admin_only(request):
    # The admin panel is for the super admin role only, even if "staff" is ticked on a branch manager.
    user = request.user
    return user.is_active and user.is_staff and getattr(user, 'is_super_admin', False)


admin.site.has_permission = _super_admin_only

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path('api/', include('api.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
