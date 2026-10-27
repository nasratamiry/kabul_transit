"""
Document checklist of a transaction: which document types its branch requires for its trade
type (config.DocumentRequirement), which it has, which are missing. A missing document is
only a warning; it never blocks saving.
"""
from collections import defaultdict

from django.db.models import Exists, OuterRef

from config.models import DocumentRequirement

from .models import Document


def _required_by_pair(pairs):
    """{(branch_id, trade_type): [codes in sort order]} for the given pairs — one query."""
    branch_ids = {branch_id for branch_id, _ in pairs}
    trade_types = {trade_type for _, trade_type in pairs}
    required = defaultdict(list)
    rows = (DocumentRequirement.objects
            .filter(branch_id__in=branch_ids, trade_type__in=trade_types, required=True, doc_type__is_active=True)
            .order_by('doc_type__sort_order', 'doc_type__code')
            .values_list('branch_id', 'trade_type', 'doc_type__code'))
    for branch_id, trade_type, code in rows:
        if (branch_id, trade_type) in pairs:
            required[(branch_id, trade_type)].append(code)
    return required


def attach_documents_status(transactions):
    """
    Set `_documents_status` on each transaction: {required, present, missing} as lists of
    document type codes. Two queries for any number of rows (no N+1).
    """
    transactions = list(transactions)
    if not transactions:
        return transactions
    required = _required_by_pair({(tx.branch_id, tx.trade_type) for tx in transactions})
    present = defaultdict(set)
    for tx_id, code in (Document.objects.filter(transaction__in=transactions)
                        .values_list('transaction_id', 'doc_type__code').distinct()):
        present[tx_id].add(code)
    for tx in transactions:
        needed = required.get((tx.branch_id, tx.trade_type), [])
        have = present.get(tx.pk, set())
        tx._documents_status = {
            'required': needed,
            'present': sorted(have),
            'missing': [code for code in needed if code not in have],
        }
    return transactions


def documents_status(tx):
    if not hasattr(tx, '_documents_status'):
        attach_documents_status([tx])
    return tx._documents_status


def missing_documents_condition():
    """
    Q-able expression for Transaction querysets: the transaction lacks at least one document
    type that its branch requires for its trade type.
    """
    has_type = Document.objects.filter(transaction=OuterRef(OuterRef('pk')), doc_type=OuterRef('doc_type'))
    unmet = DocumentRequirement.objects.filter(
        branch=OuterRef('branch'), trade_type=OuterRef('trade_type'), required=True, doc_type__is_active=True,
    ).filter(~Exists(has_type))
    return Exists(unmet)
