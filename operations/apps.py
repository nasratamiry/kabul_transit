from django.apps import AppConfig


class OperationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'operations'
    verbose_name = 'معاملات و اسناد'

    def ready(self):
        from . import signals  # noqa: F401  (deletes a document's file with its row)
