"""Expense bills: the bill of a wallet spend or a card spend, its Bill check and its approval (spec #1637,
GLOSSARY *Expense bills*, ADR-0045). The verdict is `bill_check` (pure), the one entry point `receive`, the
reading job `reading`.

THE ONE LOCK ORDER: a path that locks both an Expense and its bill locks the Expense first, then the bill
(`receive.receive_bill`'s callers, `reading.record_check`, `approval._lock_waiting`, `correct_latest_bill`'s
caller). A reading recording its result and a person deciding the same bill then queue up instead of deadlocking;
`api/expenses/test_expense_bills.TestEveryWriterLocksTheExpenseBeforeItsBill` holds it."""

BILL_DOCTYPE = "Expense Bill"

# Expense bill approval: the Vendor Invoice statuses (ADR-0045).
PENDING = "Pending"
APPROVED = "Approved"

#: `approved_by` on a bill the system approved, as on an auto-approved Vendor Invoice.
SYSTEM_APPROVER = "System"
REJECTED = "Rejected"
