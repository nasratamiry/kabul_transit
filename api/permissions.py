from rest_framework.permissions import SAFE_METHODS, BasePermission


def object_branch_id(obj, branch_field='branch'):
    """Follow `branch_field` (e.g. 'transaction__branch') from obj and return that branch's id."""
    *path, last = branch_field.split('__')
    for step in path:
        obj = getattr(obj, step, None)
        if obj is None:
            return None
    return getattr(obj, f'{last}_id', None)


class IsSuperAdmin(BasePermission):
    """Only the super admin."""
    message = 'فقط سوپر ادمین اجازهٔ این عملیات را دارد.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_super_admin)


class IsBranchStaff(BasePermission):
    """Super admin OR a branch manager (for their own branch's data)."""
    message = 'شما به این بخش دسترسی ندارید.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.user.is_super_admin or request.user.is_branch_manager

    def has_object_permission(self, request, view, obj):
        if request.user.is_super_admin:
            return True
        # Uses the view's branch_field so objects reached through a FK
        # (Document → transaction → branch) are checked too. branch_field=None
        # marks company-wide data (rates, traders) that every branch shares.
        branch_field = getattr(view, 'branch_field', 'branch')
        if branch_field is None:
            return True
        branch_id = object_branch_id(obj, branch_field)
        return branch_id is not None and branch_id == request.user.branch_id


class ReadOnlyForBranch(BasePermission):
    """Super admin: full access. Branch manager: read-only on this endpoint."""
    message = 'شما فقط اجازهٔ دیدن این بخش را دارید.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.is_super_admin:
            return True
        return request.method in SAFE_METHODS
