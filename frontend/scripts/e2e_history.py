"""
History clean-up shared by the cleanup-stage*.py scripts.

Every model is tracked by django-simple-history, so creating and deleting test data leaves
audit rows behind — a test branch alone leaves 172 FieldConfig history rows. Call these
AFTER deleting the objects: the delete itself writes one more «-» row per object.
"""
from accounts.models import Branch, User
from config.models import FieldConfig
from finance.models import ExchangeRate


def purge_history(branch_codes=(), usernames=(), rate_author=None, branch_ids=()):
    """Remove the history rows of test branches (and their FieldConfig), test users, and every
    rate the test author entered — also rates the run already deleted. Returns the row count."""
    removed = 0
    # Branches the run already deleted (e.g. DELKC) only live on in their own history rows.
    ids = set(branch_ids) | set(Branch.history.filter(code__in=list(branch_codes)).values_list('id', flat=True))
    if ids:
        removed += FieldConfig.history.filter(branch_id__in=ids).delete()[0]
    if branch_codes:
        removed += Branch.history.filter(code__in=list(branch_codes)).delete()[0]
    if usernames:
        removed += User.history.filter(username__in=list(usernames)).delete()[0]
    if rate_author is not None:
        removed += ExchangeRate.history.filter(created_by_id=rate_author).delete()[0]
    return removed
