"""Single home for the "awaiting approval" rule shared by Procurement Requests and
Sent Back Category (ADR-0010, rule B1 — a domain rule is a pure module).

A PR or SB is *awaiting approval* when its ``workflow_state`` is *Vendor Selected* or
*Partially Approved* AND at least one of its ``order_list`` items is still *Pending*.
PR and SB share the same ``order_list`` child table (``Procurement Request Item Detail``)
and the identical rule.

This module is PURE: no ``frappe.db``, no request context. It owns the *rule*. The bulk
SQL that the sidebar uses to *count* awaiting-approval docs lives in
``api/sidebar_counts.py`` and must agree with :func:`is_awaiting_approval` — that agreement
is guarded by the parity test in ``test_procurement_approval.py`` (rule B1/F1 parity pattern).

Until the other approval endpoints adopt these constants, the ``{Vendor Selected,
Partially Approved}`` + any-pending-item logic still lives copied in
``approve_vendor_quotes.py`` / ``reject_vendor_quotes.py`` /
``approve_reject_sb_vendor_quotes.py`` / the PR controller; migrating them here is the
next residence step (Candidate 6, see ADR-0010).
"""

# The workflow_state values in which a PR/SB sits on the approval screen.
AWAITING_APPROVAL_STATES = frozenset({"Vendor Selected", "Partially Approved"})

# The order_list item status that means "still needs the approver's decision".
PENDING_ITEM_STATUS = "Pending"


def _item_status(item):
    """Read ``status`` off an order_list item, tolerating both dict-shaped rows
    (``frappe.get_all``) and child-doc objects (``frappe.get_doc``)."""
    if hasattr(item, "get"):
        return item.get("status")
    return getattr(item, "status", None)


def has_pending_item(order_list_items):
    """True iff any order_list item is still Pending."""
    return any(_item_status(i) == PENDING_ITEM_STATUS for i in (order_list_items or []))


def is_awaiting_approval(workflow_state, order_list_items):
    """A PR or SB is awaiting line-item approval iff it is in an approval state AND at
    least one order_list item is still Pending. This is the single rule behind the
    sidebar "Approve" count and the approval screens (ADR-0010, rule B1)."""
    return workflow_state in AWAITING_APPROVAL_STATES and has_pending_item(order_list_items)
