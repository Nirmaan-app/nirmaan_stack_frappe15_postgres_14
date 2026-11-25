"""Approve the bills the Cashbook import copied in that still wait, or were rejected (#1755, spec #1753 stories 67-69,
"Back-fill"; owner 2026-11-25, the rejected ones included).

Since #1755 a bill the Cashbook import copies in is approved on arrival (`receive_bill(system_approve=True)`). Before
it, such a bill waited in Invoices -> Pending Approval -> Cashbook unless its Bill check said Matched. This approves
each one still waiting, and each one a person rejected, as the import would now: Approved, auto-approved, approved by
"System", approved now. Expected on production (2026-11-25): 231 Pending (171 Mismatched, 53 Not checked, 7 Not
read) and 5 Rejected, 236 in all.

WHICH BILLS: an Expense bill that is its Expense's latest, Pending or Rejected, on a wallet spend (the Cashbook
import's marker, a positive amount: `card_invoices.CASHBOOK_SPEND_SQL`), and that the import copied in. The import's
naming tells: its file is named after the line's Txn Id (`<Txn Id>.<ext>`, or `<Txn Id>-bills.pdf` merged,
`cashbook_bills.download_and_save_bills`), and a Cashbook line of that Txn Id carried bill links (the first import's
line, or a later statement's line whose bill came late). A bill a person uploaded keeps the name they gave it, and a
card bill is on no wallet spend: both are left as they are, as is a bill no longer its Expense's latest.

WHAT IS WRITTEN: only the approval fields, and on a rejected bill the rejection fields cleared. Through the document
layer, so a Version keeps the change (`Expense Bill` has no doc_events). The Bill check (verdict, remark, read
figures), the invoice number and date, and the Expense are never touched; so a rejected bill's Expense, whose
attachment the rejection cleared, keeps waiting in Pending Invoices Upload. Re-running is safe: an approved bill no
longer matches.

Dry run -- prints the count it would approve, by status and Bill check, and saves nothing (run this first):
    bench --site <site> execute nirmaan_stack.patches.v3_0.approve_cashbook_import_bills.run --kwargs "{'dry_run': True}"
The real run happens in `bench migrate` (this module is in patches.txt).
"""

from collections import Counter
from urllib.parse import parse_qs, unquote, urlsplit

import frappe

from nirmaan_stack.services.card_invoices import CASHBOOK_SPEND_SQL
from nirmaan_stack.services.expense_bills import BILL_DOCTYPE, PENDING, REJECTED
from nirmaan_stack.services.expense_bills.bill_list import EXPENSE_DOCTYPES
from nirmaan_stack.services.expense_bills.reading import system_approval

_ON_A_WALLET_SPEND = " OR ".join(
    f"""(b.expense_doctype = '{doctype}'
         AND EXISTS (SELECT 1 FROM "tab{doctype}" e WHERE e.name = b.expense AND {CASHBOOK_SPEND_SQL}))"""
    for doctype in EXPENSE_DOCTYPES
)

_CANDIDATES_SQL = f"""
    SELECT b.name, b.status, b.bill_check, b.bill_file, r.transfer_id
    FROM "tab{BILL_DOCTYPE}" b
    JOIN "tabOutflow Import Row" r ON r.name = b.statement_line
    WHERE b.is_latest = 1 AND b.status IN %(statuses)s
      AND ({_ON_A_WALLET_SPEND})
      AND EXISTS (
          SELECT 1 FROM "tabOutflow Import Row" t
          JOIN "tabOutflow Import Batch" ob ON ob.name = t.import_batch AND ob.source = 'Cashbook'
          WHERE t.transfer_id = r.transfer_id
            AND jsonb_typeof(t.bill_links::jsonb -> 'links') = 'array'
            AND t.bill_links::jsonb -> 'links' <> '[]'::jsonb)
      {{only}}
    ORDER BY b.creation, b.name
"""


def execute():
    run(dry_run=False)


def run(dry_run: bool = True) -> int:
    """Print the bills to approve, by status and Bill check; approve them unless `dry_run`. Returns how many it
    approved (or would)."""
    bills = find_import_bills()
    counts = Counter((bill.status, bill.bill_check) for bill in bills)
    print(f"Cashbook import bills to approve: {len(bills)}")
    for (status, check), n in sorted(counts.items()):
        print(f"  {status:<9} {check:<12} {n}")
    if dry_run:
        return len(bills)
    approved = approve_import_bills()
    print(f"Approved: {len(approved)}")
    return len(approved)


def find_import_bills(expenses: list[str] | None = None) -> list:
    """The bills the back-fill approves (the module docstring's WHICH BILLS), oldest first; only those of `expenses`
    when given."""
    only = "AND b.expense IN %(expenses)s" if expenses else ""
    rows = frappe.db.sql(
        _CANDIDATES_SQL.format(only=only),
        {"statuses": (PENDING, REJECTED), "expenses": tuple(expenses or ())},
        as_dict=True,
    )
    return [row for row in rows if bill_file_name(row.bill_file).startswith(row.transfer_id)]


def approve_import_bills(expenses: list[str] | None = None) -> list[str]:
    """Approve each bill `find_import_bills` gives (only those of `expenses` when given); returns their names. Does
    not commit."""
    approved = []
    for row in find_import_bills(expenses):
        bill = frappe.get_doc(BILL_DOCTYPE, row.name, for_update=True)
        if not bill.is_latest or bill.status not in (PENDING, REJECTED):
            continue  # decided or replaced since it was listed
        bill.update(system_approval())
        bill.update({"rejection_reason": None, "rejected_by": None, "rejected_on": None})
        bill.save(ignore_permissions=True)
        approved.append(bill.name)
    return approved


def bill_file_name(url: str) -> str:
    """The file name a bill's URL carries: the cloud storage app's `file_name=` (URL-encoded), else the path's last
    part (`/private/files/<name>`)."""
    parts = urlsplit(url or "")
    named = parse_qs(parts.query).get("file_name")
    return named[0] if named else unquote(parts.path.rsplit("/", 1)[-1])
