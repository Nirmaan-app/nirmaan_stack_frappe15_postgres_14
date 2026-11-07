"""Expense bills: the bill of a wallet spend or a card spend, its Bill check and its approval (spec #1637,
GLOSSARY *Expense bills*, ADR-0045). The verdict is `bill_check` (pure), the one entry point `receive`, the
reading job `reading`."""

BILL_DOCTYPE = "Expense Bill"

# Expense bill approval: the Vendor Invoice statuses (ADR-0045).
PENDING = "Pending"
APPROVED = "Approved"

#: `approved_by` on a bill the system approved, as on an auto-approved Vendor Invoice.
SYSTEM_APPROVER = "System"
