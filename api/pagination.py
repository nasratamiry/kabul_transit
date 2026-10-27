from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Lists that grow every day (transactions, hawala, office expenses): 25 per page, ?page_size= up to 200."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 200
