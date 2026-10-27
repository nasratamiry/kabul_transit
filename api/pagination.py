from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Lists that grow every day (transactions, hawala, office expenses): 25 per page, ?page_size= up to 200."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 200


class OptionalPagination(StandardPagination):
    """Paginated only when ?page= is given; otherwise the plain list (small, filtered lists)."""

    def paginate_queryset(self, queryset, request, view=None):
        if 'page' not in request.query_params:
            return None
        return super().paginate_queryset(queryset, request, view)
