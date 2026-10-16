# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""What Create and Rectify write for a completed Porter order (#1445, #1449, ADR-0032).

PURE MODULE -- no `frappe`, no database. The Expense's description and Paid by (spec #1442 stories 47-48,
63) and its Porter Order's details, from one statement line's columns (`porter.statement_line`). The
jobs around them live in `api/outflow_import/porter_create.py` and `porter_rectify.py`.
"""

from __future__ import annotations

from collections.abc import Mapping

from nirmaan_stack.services.outflow_import.normalize import normalize_amount

__all__ = [
    "booked_by",
    "description_hand_edited",
    "expense_description",
    "porter_order_fields",
    "rectified_description",
]


def expense_description(booked_by: str | None, project_name: str | None) -> str:
    """The owner's wording (spec #1442 story 48): "Porter Delivery raised by {name} for {project}", or
    without " for {project}" on a Non-Project Expense. A blank name drops "raised by"."""
    name = (booked_by or "").strip()
    project = (project_name or "").strip()
    text = f"Porter Delivery raised by {name}" if name else "Porter Delivery"
    return f"{text} for {project}" if project else text


def booked_by(statement: Mapping[str, str]) -> str:
    """Who booked the order, as Create writes it into the description and `payment_by`: the statement
    line's `customer_name`, trimmed. Rectify (#1449) asks the same function, so both agree."""
    return (statement.get("customer_name") or "").strip()


def rectified_description(
    stored: str | None, booker: str | None, old_project_name: str | None, new_project_name: str | None
) -> str:
    """The description a Rectify (#1449) writes on the replacement Expense (spec #1442 story 63).

    Rewritten for the new placement when the stored text is still exactly what Create generated for the
    old one (surrounding whitespace aside), or blank. Anything else was hand-edited and is kept word for
    word: "hand-edited" MEANS "differs from the generated text", so no Version history is read.
    """
    if description_hand_edited(stored, booker, old_project_name):
        return stored
    return expense_description(booker, new_project_name)


def description_hand_edited(stored: str | None, booker: str | None, project_name: str | None) -> bool:
    """Whether a Porter Expense's description differs from what Create generated for its placement (blank
    and surrounding whitespace aside). A Rectify keeps such a description as it is."""
    text = (stored or "").strip()
    return bool(text) and text != expense_description(booker, project_name)


# `Porter Order` field <- Porter's statement column. The completion time is the line's own parsed
# `added_on`; the invoice and the line are links the caller sets.
_ORDER_TEXT_FIELDS = (
    ("crn", "crn"),
    ("vehicle_type", "vehicle_type"),
    ("city", "city"),
    ("from_address", "from_address"),
    ("to_address", "to_address"),
    ("waypoint_addresses", "waypoint_addresses"),
    ("travel_duration", "travel_duration"),
    ("waiting_time", "waiting_time"),
    ("booked_by", "customer_name"),
    ("booked_by_mobile", "customer_mobile"),
    ("booked_by_email", "customer_email"),
    ("remark", "customer_remarks"),
    ("order_status", "order_status"),
)


def porter_order_fields(statement: Mapping[str, str]) -> dict:
    """A `Porter Order`'s order details, from one statement line's columns (`statement_line`).

    Text is trimmed; `fare` is the Porter fare (the Expense amount) and `rcm_gst` the reverse-charge GST
    the statement prints for the order, which is NEVER part of the Expense.
    """
    fields: dict = {field: (statement.get(column) or "").strip() for field, column in _ORDER_TEXT_FIELDS}
    fields["distance_km"] = normalize_amount(statement.get("travel_distance_kms"))
    fields["fare"] = normalize_amount(statement.get("invoice_order_fare"))
    fields["rcm_gst"] = normalize_amount(statement.get("tax_amount"))
    return fields
