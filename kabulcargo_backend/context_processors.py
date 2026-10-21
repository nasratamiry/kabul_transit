from kabulcargo_backend import branding as brand


def branding(request):
    """Expose brand tokens to templates (the admin skin reads its colors from here)."""
    return {'brand': brand}
