class PortScopedQuerysetMixin:
    """
    Automatically filter a ViewSet's queryset to the user's branch unless they
    are a super admin. Expects the model to have a `branch` ForeignKey (or
    override `branch_field` on the ViewSet, e.g. 'transaction__branch').
    """
    branch_field = 'branch'

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_super_admin:
            return qs
        if user.is_branch_manager and user.branch_id:
            return qs.filter(**{f'{self.branch_field}_id': user.branch_id})
        return qs.none()  # safety: unknown role → nothing


def own_branch_kwargs(user):
    """Spoofing block: a branch manager always saves into their own branch, whatever the body says."""
    return {'branch': user.branch} if user.is_branch_manager else {}
