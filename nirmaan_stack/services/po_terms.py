# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A PO payment term mirrors its payment's status. The payment's own hook keeps it in step one save at a
time (`integrations/controllers/project_payments._find_and_update_po_term`); a caller that moves several
payments of one PO at once (bulk approval, a cheque's decision and clear) sets each term in memory with
`sync_term_in_memory` and saves the PO once.
"""

#: What `sync_term_in_memory` did: changed the term (the caller saves the PO), found it already there, or
#: found no term naming the payment (the caller logs it).
TERM_UPDATED = "updated"
TERM_NOOP = "noop"
TERM_ORPHAN = "orphan"


def sync_term_in_memory(po_doc, payment_name: str, new_status: str) -> str:
    """Set the term of `po_doc` that names `payment_name` to `new_status`, in memory; the caller saves the
    PO once. Returns `TERM_UPDATED`, `TERM_NOOP` or `TERM_ORPHAN`."""
    for term in po_doc.get("payment_terms") or []:
        if term.project_payment == payment_name:
            if term.term_status != new_status:
                term.term_status = new_status
                return TERM_UPDATED
            return TERM_NOOP
    return TERM_ORPHAN
