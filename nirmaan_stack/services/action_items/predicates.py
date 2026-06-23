"""
Project Action Item — PURE predicates (no DB access).

These functions take plain values / dicts and return booleans. They contain the
ENTIRE business definition of the two v1 obligations (DN_PENDING, DC_PENDING) and
nothing else — so they are trivially unit-testable and can be exercised against the
full §9 test matrix with zero fixtures. The reconciler (reconcile.py) does all the
DB I/O and feeds these predicates plain dicts.

The definitions here are the CORRECTED, red-teamed versions from
`.claude/context/domain/action-center.md` (v2) — NOT the older derive-on-read report
logic. See docs/prd/project-action-items.md §2/§14.

Key correctness invariants (from the red-team, §14):
  * "fully delivered" uses the SAME 2.5%-float / integer-exact tolerance as
    `calculate_order_status` in api/delivery_notes/update_delivery_note.py — so this
    predicate can NEVER disagree with a PO's own derived status.
  * `is_dispatched` is a BOOLEAN, not a quantity: a dispatched item's expected qty is
    `item.quantity`.
  * DC_PENDING is tested at the ITEM level ("a DN exists" == ∃ item received_quantity>0),
    NOT via PO status — a sticky `Partially Dispatched` PO that has deliveries would be
    a false-negative if keyed on status.
  * NULL / "" billing_status counts as Billable.
"""

# --- action_type constants ------------------------------------------------------- #

ACTION_DN_PENDING = "DN_PENDING"
ACTION_DC_PENDING = "DC_PENDING"

# The role_profile FIELD VALUE — note the "Profile" suffix. This is NOT the Frappe
# Role "Nirmaan Project Manager" (no suffix). Hardcoded per §14 (Med).
ASSIGNED_ROLE_PM = "Nirmaan Project Manager Profile"

# Live-delivery PO status allow-list. Deliberately EXCLUDES PO Approved, Merged,
# Cancelled, Inactive — so merged/cancelled POs never generate action items.
LIVE_STATUSES = frozenset(
    {"Dispatched", "Partially Dispatched", "Partially Delivered", "Delivered"}
)

# Items in this category are never an obligation (ad-hoc freight/charges, always
# "received" by definition) — excluded from both predicates' item scans.
_ADDITIONAL_CHARGES = "Additional Charges"

# Same tolerance constant as calculate_order_status (2.5%).
_TOLERANCE_PERCENT = 2.5


def _to_float(value, default=0.0):
    """Coerce a possibly-None / string value to float, defaulting on failure."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def is_billable(billing_status) -> bool:
    """A PO is Billable unless its billing_status is explicitly 'Non-Billable'.

    NULL / "" / unset all count as Billable (the conservative default — we'd rather
    surface a maybe-billable obligation than silently drop a real one).
    """
    return billing_status != "Non-Billable"


def item_fully_delivered(quantity, received) -> bool:
    """Mirror `calculate_order_status`'s per-item "delivered" test EXACTLY.

    Float quantity (either ordered or received has a fractional part) → a 2.5%
    under-delivery tolerance: delivered iff ``received >= quantity*(1 - 0.025)``.
    Integer-valued quantity → exact: delivered iff ``received >= quantity``.

    This branch selection (``quantity % 1 != 0 or received % 1 != 0``) and the
    tolerance arithmetic (``quantity - (quantity*2.5)/100 <= received``) are
    copied verbatim from update_delivery_note.calculate_order_status so the two can
    never drift.
    """
    quantity = _to_float(quantity)
    received = _to_float(received)

    is_float_quantity = quantity % 1 != 0 or received % 1 != 0
    if is_float_quantity:
        return (quantity - ((quantity * _TOLERANCE_PERCENT) / 100)) <= received
    return quantity <= received


def is_dn_pending(po_status, billing_status, items) -> bool:
    """DN_PENDING — "dispatched, not fully delivered".

    True iff the PO is Billable AND live AND not already fully Delivered AND it has at
    least one real (non-Additional-Charges) item that has been dispatched
    (``is_dispatched == 1``) but is NOT yet fully delivered (tolerance rule).

    ``items`` is an iterable of dicts/objects exposing ``category``,
    ``is_dispatched``, ``quantity``, ``received_quantity``.
    """
    if not is_billable(billing_status):
        return False
    if po_status not in LIVE_STATUSES:
        return False
    if po_status == "Delivered":
        # A fully-Delivered PO has no outstanding delivery obligation by definition.
        return False

    for item in items:
        if _item_get(item, "category") == _ADDITIONAL_CHARGES:
            continue
        if int(_to_float(_item_get(item, "is_dispatched"), 0)) != 1:
            continue
        if not item_fully_delivered(
            _item_get(item, "quantity"), _item_get(item, "received_quantity")
        ):
            return True
    return False


def is_dc_pending(po_status, billing_status, items, has_delivery_challan) -> bool:
    """DC_PENDING — "a delivery happened but no Delivery Challan was filed".

    True iff the PO is Billable AND live AND at least one real item has actually been
    received (``received_quantity > 0`` — i.e. a DN exists, tested at the ITEM level so
    a sticky `Partially Dispatched` PO with deliveries is NOT missed) AND there is NO
    non-stub Delivery-Challan ``PO Delivery Documents`` parented to the PO.

    ``has_delivery_challan`` is the caller's pre-computed boolean ("a non-stub
    type=='Delivery Challan' PDD exists for this PO").
    """
    if not is_billable(billing_status):
        return False
    if po_status not in LIVE_STATUSES:
        return False
    if has_delivery_challan:
        return False

    for item in items:
        if _item_get(item, "category") == _ADDITIONAL_CHARGES:
            continue
        if _to_float(_item_get(item, "received_quantity"), 0) > 0:
            return True
    return False


def _item_get(item, key, default=None):
    """Read a field from an item that may be a plain dict or a Frappe doc/_dict."""
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)
