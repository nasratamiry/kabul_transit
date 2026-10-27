from rest_framework.decorators import action
from rest_framework.response import Response

from kabulcargo_backend.utils import dual_date

# Bookkeeping fields: they change on every save or never, so they are not "changes".
_SKIP = {'id', 'created_at', 'updated_at', 'created_by', 'uploaded_at', 'uploaded_by', 'balance'}
_YES_NO = {True: 'بلی', False: 'نخیر'}


def _display(field, value, record):
    """A history value as text: choice label, related object's name, بلی/نخیر, or str()."""
    if value is None or value == '':
        return None
    if field.is_relation:
        try:
            related = getattr(record, field.name)
        except Exception:  # the related row was deleted since
            related = None
        return str(related) if related is not None else f'#{value}'
    if field.choices:
        return str(dict(field.flatchoices).get(value, value))
    if isinstance(value, bool):
        return _YES_NO[value]
    return str(value)


class HistoryMixin:
    """
    Adds GET <resource>/<id>/history/ to a ModelViewSet whose model has
    simple-history HistoricalRecords. get_object() is used, so the viewset's own
    permissions and branch scoping apply (another branch's record → 404).

    Newest first; each entry: history_id, type («ایجاد شد» / «تغییر کرد» / «حذف شد»),
    date ('Shamsi | Gregorian'), user, and changes = [{field, label, old, new}] —
    only the fields that differ from the version before (empty for the first one).
    """

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        obj = self.get_object()
        model = type(obj)
        fields = {f.name: f for f in model._meta.concrete_fields if f.name not in _SKIP}
        records = list(obj.history.select_related('history_user').order_by('history_date', 'history_id'))
        entries = []
        previous = None
        for record in records:
            changes = []
            if previous is not None:
                delta = record.diff_against(previous, included_fields=list(fields))
                for change in delta.changes:
                    field = fields[change.field]
                    changes.append({
                        'field': change.field,
                        'label': str(field.verbose_name),
                        'old': _display(field, change.old, previous),
                        'new': _display(field, change.new, record),
                    })
            entries.append({
                'history_id': record.history_id,
                'type': record.get_history_type_display(),
                'date': dual_date(record.history_date),
                'user': record.history_user.get_username() if record.history_user else None,
                'changes': changes,
            })
            previous = record
        entries.reverse()
        return Response(entries)
