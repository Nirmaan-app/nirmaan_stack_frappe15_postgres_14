# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Every writer of an Expense's `invoice_attachment` goes through the one bill entry point (#1639, spec #1637).

    devenv.sh unit nirmaan_stack.services.expense_bills.test_bill_writers

It reads the source: every backend module (by its syntax tree) and every frontend file (by pattern) that writes
`invoice_attachment` must be listed below, as the entry point, as a writer a later ticket of spec #1637 moves
onto it, or as a writer of some other record. A path added later that writes the field fails here until it goes
through `expense_bills.receive.receive_bill` or is listed with its reason. A listed file that no longer writes the
field fails too, so each ticket that moves a writer removes its line.

What it cannot see: a write that never names the field (a Desk form, a generic `doc.update(form_dict)`).
"""

import ast
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIELD = "invoice_attachment"

#: The one entry point (`receive_bill`).
ENTRY_POINT = {
    "nirmaan_stack/services/expense_bills/receive.py": "receive_bill: records the Expense bill and queues its reading",
}

#: Writers that only CLEAR a wallet spend's or card spend's bill: no bill lands, so none is recorded or read.
CLEARS = {
    "nirmaan_stack/services/expense_bills/approval.py": "reject_bill: the Expense waits for a new bill; its Expense "
    "bill keeps the file (#1644)",
}

#: Writers of a wallet spend's or card spend's bill that do not yet go through the entry point. Each later ticket
#: of spec #1637 moves its writer and removes its line here.
LATER_TICKETS = {
    "nirmaan_stack/api/outflow_import/cashbook_bills.py": "Cashbook import's bill copy and late bill (#1637 ticket 2)",
    "nirmaan_stack/services/outflow_import/settle.py": "Collect payment Create's raw set_value (#1637 ticket 2)",
}

#: Writers that send a wallet spend's or card spend's new bill through the entry point and write every other
#: Expense's bill themselves.
ROUTES = {
    "nirmaan_stack/services/expense_decision.py": "save_paid_invoice, Payment Done's replace (#1643); Mark as Paid and "
    "the raiser's invoice, on Expenses no statement made",
}

#: Hand edits of any Expense through the REST API. They can replace the bill of a wallet spend or card spend, and
#: they are not among the spec's six arrival paths: listed for the owner's ruling (report, Open questions).
HAND_EDITS = {
    "frontend/src/pages/NonProjectExpenses/components/EditNonProjectExpense.tsx": "Edit Non-Project Expense dialog",
    "frontend/src/pages/NonProjectExpenses/components/UpdateInvoiceDetailsDialog.tsx": "Update Invoice Details dialog",
    "frontend/src/pages/NonProjectExpenses/components/UpdatePaymentDetailsDialog.tsx": "Non-Project Update Payment",
    "frontend/src/pages/ProjectExpenses/components/EditProjectExpenseDialog.tsx": "Edit Project Expense dialog",
    "frontend/src/pages/ProjectExpenses/components/UpdatePaymentDetailsDialog.tsx": "Project Update Payment",
}

#: Writers of some other record's field of that name, or response rows that only carry it: never a wallet spend's
#: or card spend's bill.
OTHER_RECORDS = {
    "nirmaan_stack/api/approvals/expense_detail.py": "a response row for the approval screen",
    "nirmaan_stack/api/delivery_notes/update_invoice_data.py": "PO / SR Vendor Invoices",
    "nirmaan_stack/api/expense_requests/flatten.py": "Expense Request rows",
    "nirmaan_stack/api/expense_requests/invoice.py": "an Expense Request's Expense (raised by hand, no statement)",
    "nirmaan_stack/patches/v3_0/migrate_invoices_to_vendor_invoices.py": "Vendor Invoices migration (append-only)",
    "nirmaan_stack/services/reimbursements/convert.py": "a Reimbursement's Expense (spec #1637: out of scope)",
}

KNOWN = {**ENTRY_POINT, **CLEARS, **ROUTES, **LATER_TICKETS, **HAND_EDITS, **OTHER_RECORDS}

_WRITE_CALLS = {"set_value", "db_set", "save_file"}
_FIELD_KEYWORDS = {"df", "fieldname", "attached_to_field"}
_TS_WRITES = (
    re.compile(r"\.invoice_attachment\s*=(?!=)"),  # obj.invoice_attachment = url
    re.compile(r"fieldname:\s*[\"']invoice_attachment[\"']"),  # an upload aimed at the field
)


def _is_field(node) -> bool:
    return isinstance(node, ast.Constant) and node.value == FIELD


def python_writes(source: str) -> bool:
    """Does this module write `invoice_attachment`: assign it, key it in a dict, name it in a set_value-like call,
    as an upload's field or in a tuple of field names? Docstrings and comments are not code, so they never count.
    A list of field names is a read (`fields=[...]`)."""
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(t, ast.Attribute) and t.attr == FIELD for t in targets):
                return True
        elif isinstance(node, ast.Dict) and any(_is_field(key) for key in node.keys):
            return True
        elif isinstance(node, ast.Dict) and any(
            isinstance(key, ast.Constant) and key.value == "attached_to_field" and _is_field(value)
            for key, value in zip(node.keys, node.values)
        ):
            return True
        elif isinstance(node, ast.Tuple) and any(_is_field(element) for element in node.elts):
            # A tuple of field names an update walks (`INVOICE_FIELDS`), or a (field, value) pair.
            return True
        elif isinstance(node, ast.Call):
            name = getattr(node.func, "attr", None) or getattr(node.func, "id", None)
            if name in _WRITE_CALLS and any(_is_field(arg) for arg in node.args):
                return True
            if any(kw.arg in _FIELD_KEYWORDS and _is_field(kw.value) for kw in node.keywords):
                return True
    return False


def writers() -> set[str]:
    """Every non-test source file, backend and frontend, that writes the field, as a repo-relative path."""
    found = set()
    for path in (REPO / "nirmaan_stack").rglob("*.py"):
        if path.name.startswith("test_") or FIELD not in (text := path.read_text(errors="ignore")):
            continue
        if python_writes(text):
            found.add(path.relative_to(REPO).as_posix())
    for path in (REPO / "frontend" / "src").rglob("*.ts*"):
        if ".test." in path.name or FIELD not in (text := path.read_text(errors="ignore")):
            continue
        if any(pattern.search(text) for pattern in _TS_WRITES):
            found.add(path.relative_to(REPO).as_posix())
    return found


def calls(path: str) -> set[str]:
    """The names of every function `path` calls."""
    tree = ast.parse((REPO / path).read_text())
    return {
        getattr(node.func, "attr", None) or getattr(node.func, "id", None)
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
    }


class TestEveryBillWriterGoesThroughTheEntryPoint(unittest.TestCase):
    def test_every_writer_of_the_invoice_attachment_is_the_entry_point_or_listed_with_its_reason(self):
        unknown = sorted(writers() - set(KNOWN))
        self.assertEqual(
            unknown, [],
            "These write an Expense's invoice_attachment without going through "
            "expense_bills.receive.receive_bill. Route them through it, or list them here with the reason.",
        )

    def test_every_listed_writer_still_writes_it(self):
        stale = sorted(set(KNOWN) - writers())
        self.assertEqual(stale, [], "These no longer write invoice_attachment: remove their line.")

    def test_the_credit_card_and_cashbook_tabs_file_their_bill_through_the_entry_point(self):
        for tab in ("nirmaan_stack/api/expenses/card_invoices.py", "nirmaan_stack/api/expenses/cashbook_invoices.py"):
            with self.subTest(tab=tab):
                self.assertNotIn(tab, writers())
                self.assertIn("save_invoice", calls(tab))
        self.assertIn("receive_bill", calls("nirmaan_stack/services/expense_invoices.py"))
        self.assertNotIn("nirmaan_stack/services/expense_invoices.py", writers())

    def test_each_router_calls_the_entry_point(self):
        for path in ROUTES:
            with self.subTest(path=path):
                self.assertIn("receive_bill", calls(path))

    def test_a_module_that_writes_the_field_is_caught_and_one_that_only_mentions_it_is_not(self):
        self.assertTrue(python_writes("doc.invoice_attachment = url"))
        self.assertTrue(python_writes('frappe.db.set_value(dt, name, "invoice_attachment", url)'))
        self.assertTrue(python_writes('doc.update({"invoice_attachment": url})'))
        self.assertTrue(python_writes('save_file(fname, content, dt, dn, df="invoice_attachment")'))
        self.assertFalse(python_writes('"""Writes {"invoice_attachment": url}."""\nx = doc.invoice_attachment'))
        self.assertTrue(python_writes('INVOICE_FIELDS = ("invoice_date", "invoice_ref", "invoice_attachment")'))
        self.assertFalse(python_writes('frappe.get_all(dt, fields=["name", "invoice_attachment"])'))
        self.assertFalse(python_writes("facts = Facts(invoice_attachment=doc.invoice_attachment)"))


if __name__ == "__main__":
    unittest.main()
