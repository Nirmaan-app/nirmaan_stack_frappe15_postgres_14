# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A new statement re-opens the lines earlier imports wrongly skipped as own balances (#1596, spec #1585
"Re-opening old wrong skips", user stories 46-48, ADR-0015 Amendment B decision 8).

Seam 1, two uploads in one test: an OLD-RULE staged batch of the real-file fixture (`cashbook_statement.xlsx`) --
every line that is not a Wallet Spend skipped as own balances, a refund or wallet credit stored at amount 0 and no
Type stored, as the earlier import left them; its spends created by the job -- then the same statement posted to
the Cashbook import endpoints (`preview_cashbook_statement`, `confirm_cashbook_import`), the job run inline. Only
the transport is faked: the posted file, the queue, the clock of the link-expiry check and the bill downloader.

Run: DEVENV test --module nirmaan_stack.api.outflow_import.test_cashbook_reopen
"""

import dataclasses
import io
from datetime import timedelta
from unittest.mock import patch

from openpyxl import load_workbook

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import file_manager

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import cashbook_bills as bills
from nirmaan_stack.api.outflow_import.test_cashbook_bills import STATEMENT, _fake_bills
from nirmaan_stack.api.outflow_import.test_cashbook_import import _purge
from nirmaan_stack.api.outflow_import.test_cashbook_statement_upload import EARLIEST_EXPIRY
from nirmaan_stack.services.outflow_import.bill_download import BillRefused
from nirmaan_stack.services.outflow_import.parser import parse_statement

ROW_DOCTYPE = "Outflow Import Row"
OWN_BALANCES = "Moves money between our own balances, not a spend"
HIGHLIGHT = "Shop-requested payment, check it."

COLLECT_WITH_LINK, COLLECT_NO_LINK = "OBO9000000000001CPLINK", "OBO9000000000002CPNONE"
COLLECT_FULL, REFUND_FULL = "OBO9000000000003CPFULL", "REF-OBO9000000000003CPFULL"
PART_REFUND, ADJUSTMENT = "REF-OBO9000000000004PARTSP", "REF-OBO9000000000005ADJFUL"
EARLIER_REFUND, WALLET_CREDIT = "REF-OBO9000000000008EARLYR", "PTM9000000006"
INTERNAL = ("BUSINESS_USER-900001-0", "VALOAD-9000001", "BUSINESS_USER-900002-0", "BUSINESS_USER-900007-1")
SPENDS_OF_THE_OLD_BATCH = 10  # the fixture's Wallet Spends, all created by the old rules

_FIELDS = [
    "name", "import_batch", "transfer_id", "amount", "direction", "row_status", "skip_kind", "skip_origin",
    "skip_reason", "outcome_note", "row_kind", "suggested_doctype", "stored_bill",
]


def _post(endpoint, content: bytes, filename: str):
    """POST `content` as the multipart `file` to a Cashbook endpoint, as Administrator."""
    from werkzeug.datastructures import FileStorage, MultiDict

    class _Request:
        files = MultiDict({"file": FileStorage(stream=io.BytesIO(content), filename=filename)})
        host = None  # `save_file` asks the request for its host

    previous = getattr(frappe.local, "request", None)
    frappe.set_user("Administrator")
    frappe.local.request = _Request()
    try:
        return endpoint()
    finally:
        frappe.local.request = previous


def _with_suffix(content: bytes, suffix: str) -> bytes:
    """The statement with `suffix` after every Txn Id (the env DB is a copy of production, which holds some of the
    fixture's real ones). A refund's `REF-<Txn Id>` keeps naming its spend."""
    book = load_workbook(io.BytesIO(content))
    sheet = book.active
    for row in sheet.iter_rows():
        header = next((cell for cell in row if cell.value == "Txn Id"), None)
        if header:
            break
    for (cell,) in sheet.iter_rows(min_row=header.row + 1, min_col=header.column, max_col=header.column):
        if isinstance(cell.value, str) and cell.value.strip():
            cell.value = cell.value.strip() + suffix
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


class ReopenCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.suffix = "R" + frappe.generate_hash(length=6).upper()
        self.content = _with_suffix(STATEMENT.read_bytes(), self.suffix)
        self.parsed = parse_statement(self.content, source="Cashbook")
        ids = [row.transfer_id for row in self.parsed.rows]
        assert not frappe.db.exists(ROW_DOCTYPE, {"transfer_id": ["in", ids]}), "fixture Txn Ids already staged"
        self.batches: list[str] = []
        self.addCleanup(self._cleanup)
        self.old = self._stage_old_rule_batch()

    def _cleanup(self):
        frappe.db.rollback()
        for batch in self.batches:
            for match in frappe.get_all(
                "Outflow Row Match", filters={"import_batch": batch}, fields=["target_doctype", "target_name"]
            ):
                frappe.db.delete("File", {"attached_to_doctype": match.target_doctype, "attached_to_name": match.target_name})
            lines = frappe.get_all(ROW_DOCTYPE, filters={"import_batch": batch}, pluck="name")
            if lines:
                frappe.db.delete("File", {"attached_to_doctype": ROW_DOCTYPE, "attached_to_name": ["in", lines]})
                frappe.db.delete("Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", lines]})
                frappe.db.delete("Version", {"ref_doctype": ROW_DOCTYPE, "docname": ["in", lines]})
            frappe.db.delete("File", {"attached_to_doctype": "Outflow Import Batch", "attached_to_name": batch})
            _purge(batch)
        frappe.db.commit()

    def _stage_old_rule_batch(self) -> str:
        """The batch an import before #1594 left: every non-spend line read as an own-balances movement (its Debit as
        its amount, so a refund or wallet credit holds 0), no Type stored, and the spends created by the job."""
        as_old = dataclasses.replace(
            self.parsed,
            rows=[
                row if row.row_kind == "Wallet Spend" else dataclasses.replace(row, row_kind="VA → Wallet")
                for row in self.parsed.rows
            ],
        )
        batch = cb._stage(
            as_old, cb._build_plan(as_old), file_url="/private/files/old.xlsx", filename="old.xlsx", user="Administrator"
        ).name
        self.batches.append(batch)
        frappe.db.sql("""UPDATE "tabOutflow Import Row" SET row_kind = NULL WHERE import_batch = %s""", (batch,))
        frappe.db.commit()
        with patch.object(bills, "fetch_bill", _fake_bills()):
            cb._cashbook_worker(batch, "Administrator")
        return batch

    def _clock(self):
        return patch.object(cb, "_utc_now", return_value=EARLIEST_EXPIRY - timedelta(days=3))

    def _preview(self) -> dict:
        with self._clock():
            return _post(cb.preview_cashbook_statement, self.content, "statement.xlsx")

    def _upload(self) -> dict:
        def run_now(batch, actor, **kwargs):
            cb._cashbook_worker(batch, actor, **kwargs)

        with self._clock(), patch.object(bills, "fetch_bill", _fake_bills()), patch.object(
            cb, "_enqueue_worker", side_effect=run_now
        ):
            result = _post(cb.confirm_cashbook_import, self.content, "statement.xlsx")
        self.batches.append(result["batch"])
        return result

    def _only_line(self, txn: str):
        lines = frappe.get_all(ROW_DOCTYPE, filters={"transfer_id": txn + self.suffix}, fields=_FIELDS)
        self.assertEqual(len(lines), 1, f"{txn}: {lines}")
        return lines[0]

    def _expense_matches(self) -> int:
        return frappe.db.count(
            "Outflow Row Match", {"import_batch": ["in", self.batches], "match_kind": "Settled"}
        )


class TestTheNewStatementReopensTheWrongSkips(ReopenCase):
    def test_each_collect_payment_refund_and_wallet_credit_comes_back_under_the_new_rules_on_its_own_line(self):
        new = self._upload()["batch"]

        for txn in (COLLECT_WITH_LINK, COLLECT_NO_LINK):
            line = self._only_line(txn)
            self.assertEqual(
                (line.import_batch, line.row_status, line.outcome_note, line.row_kind),
                (self.old, "Mismatched", HIGHLIGHT, "Collect Payment"),
                txn,
            )
            self.assertFalse(line.skip_reason or line.skip_kind or line.skip_origin, txn)

        for txn in (COLLECT_FULL, REFUND_FULL):
            line = self._only_line(txn)
            self.assertEqual(
                (line.import_batch, line.row_status, line.skip_kind, line.skip_origin),
                (self.old, "Skipped", "Paired wallet refund", "System"),
                txn,
            )
        self.assertIn(COLLECT_FULL + self.suffix, self._only_line(REFUND_FULL).skip_reason)

        for txn, amount in ((PART_REFUND, 11248.0), (ADJUSTMENT, 2600.0), (EARLIER_REFUND, 640.0), (WALLET_CREDIT, 9000.0)):
            line = self._only_line(txn)
            self.assertEqual(
                (line.import_batch, line.row_status, line.amount, line.direction),
                (self.old, "Mismatched", amount, "Credit"),
                txn,
            )
        self.assertTrue(self._only_line(WALLET_CREDIT).outcome_note.startswith("Wallet credit:"))
        self.assertIn("not recorded from this statement", self._only_line(ADJUSTMENT).outcome_note)

        self.assertEqual(frappe.db.count(ROW_DOCTYPE, {"import_batch": new}), 0)

    def test_the_reopen_is_recorded_on_the_line(self):
        new = self._upload()["batch"]

        line = self._only_line(WALLET_CREDIT)
        comments = frappe.get_all(
            "Comment",
            filters={"reference_doctype": ROW_DOCTYPE, "reference_name": line.name, "comment_type": "Comment"},
            pluck="content",
        )
        self.assertEqual(len(comments), 1)
        self.assertIn(f"Re-opened by the Cashbook import {new}", comments[0])
        self.assertIn("own balances", comments[0])
        version = frappe.get_last_doc("Version", filters={"ref_doctype": ROW_DOCTYPE, "docname": line.name})
        changed = {field for field, *_ in frappe.parse_json(version.data)["changed"]}
        self.assertTrue({"row_status", "amount", "skip_reason"} <= changed, changed)

    def test_reopening_creates_no_expense(self):
        before = self._expense_matches()
        self.assertEqual(before, SPENDS_OF_THE_OLD_BATCH)

        self._upload()

        self.assertEqual(self._expense_matches(), before)
        for txn in (COLLECT_WITH_LINK, COLLECT_NO_LINK, COLLECT_FULL):
            for doctype in ("Project Expenses", "Non Project Expenses"):
                self.assertFalse(frappe.db.exists(doctype, {"payment_ref": txn + self.suffix}), txn)

    def test_a_reopened_collect_payment_has_its_bill_copied_onto_its_line(self):
        self._upload()
        self.assertTrue(self._only_line(COLLECT_WITH_LINK).stored_bill)

    def test_the_earlier_import_counts_its_reopened_lines_as_open(self):
        self._upload()
        self.assertEqual(cb.get_cashbook_status(self.old)["open"], 6)

    def test_a_second_upload_of_the_same_statement_reopens_nothing_more(self):
        self._upload()
        with self.assertRaises(frappe.ValidationError):
            self._upload()
        self._only_line(WALLET_CREDIT)


class TestOtherSkipsStay(ReopenCase):
    def test_real_internal_movements_stay_skipped_as_own_balances(self):
        self._upload()
        for txn in INTERNAL:
            line = self._only_line(txn)
            self.assertEqual((line.import_batch, line.row_status, line.skip_reason), (self.old, "Skipped", OWN_BALANCES))

    def test_a_line_skipped_for_another_reason_stays_skipped(self):
        for txn in (COLLECT_NO_LINK, WALLET_CREDIT):
            frappe.db.set_value(
                ROW_DOCTYPE,
                {"import_batch": self.old, "transfer_id": txn + self.suffix},
                {"skip_reason": "Did not succeed at the wallet", "skip_kind": "Bank refused"},
            )
        frappe.db.commit()

        self._upload()

        for txn in (COLLECT_NO_LINK, WALLET_CREDIT):
            line = self._only_line(txn)  # and no second line staged for it
            self.assertEqual((line.row_status, line.skip_kind), ("Skipped", "Bank refused"), txn)


class TestALineTakenMeanwhileFallsBackToTheOrdinaryRule(ReopenCase):
    """Code review S6: the plan says a line re-opens an earlier own-balances skip, but by the time confirm locks that
    earlier line another import (or a person) has changed it. The line must not vanish -- neither re-opened nor
    staged -- but take what the plan gives it without the re-open."""

    def test_the_line_is_handled_as_if_there_were_nothing_to_reopen(self):
        stale = cb.wrong_skips([row.transfer_id for row in self.parsed.rows])
        taken = self._only_line(COLLECT_NO_LINK)
        self.assertIn(taken.name, {skip.line for skip in stale})
        # Another import re-opened it after this confirm read the wrong skips.
        frappe.db.set_value(
            ROW_DOCTYPE,
            taken.name,
            {"row_status": "Mismatched", "skip_reason": None, "skip_kind": None, "skip_origin": None},
            update_modified=False,
        )
        frappe.db.commit()
        txn = COLLECT_NO_LINK + self.suffix
        expected = cb._build_plan(self.parsed)  # what the plan gives now: nothing left to re-open for it
        self.assertNotIn(txn, {row.transfer_id for row in expected.reopening})
        expected_staged = txn in {row.transfer_id for row in expected.rows if not row.reopens}

        with patch.object(cb, "wrong_skips", return_value=stale):
            new = self._upload()["batch"]

        self.assertEqual(
            frappe.db.count(ROW_DOCTYPE, {"import_batch": new, "transfer_id": txn}), 1 if expected_staged else 0
        )
        self.assertEqual(
            frappe.db.get_value("Outflow Import Batch", new, "repeats_not_saved"), expected.split.repeats_not_saved
        )
        # The other wrong skips are still re-opened.
        self.assertEqual(self._only_line(WALLET_CREDIT).row_status, "Mismatched")
        self.assertEqual(self._only_line(WALLET_CREDIT).import_batch, self.old)

    def test_a_line_taken_while_the_statement_is_saved_falls_back_too(self):
        """Code review R4: confirm's `save_file` commits, which ends the first claim. A line taken in that window is
        found by the claim after the save and follows the ordinary rule; confirm is never refused for it."""
        real_save_file = file_manager.save_file
        taken = self._only_line(COLLECT_NO_LINK)

        def save_then_another_import_takes_the_line(*args, **kwargs):
            saved = real_save_file(*args, **kwargs)
            frappe.db.commit()
            frappe.db.set_value(
                ROW_DOCTYPE,
                taken.name,
                {"row_status": "Mismatched", "skip_reason": None, "skip_kind": None, "skip_origin": None},
                update_modified=False,
            )
            frappe.db.commit()
            return saved

        with patch.object(file_manager, "save_file", save_then_another_import_takes_the_line):
            new = self._upload()["batch"]

        # Not re-opened by this import (no Comment naming it), and the other wrong skips still are.
        comments = frappe.get_all(
            "Comment", filters={"reference_doctype": ROW_DOCTYPE, "reference_name": taken.name, "comment_type": "Comment"}
        )
        self.assertEqual(comments, [])
        self.assertEqual(self._only_line(WALLET_CREDIT).row_status, "Mismatched")
        self.assertTrue(frappe.db.exists("Outflow Import Batch", new))


class TestTheReopeningImportOwnsTheBillCopy(ReopenCase):
    """Code review R1: a re-opened Collect payment stays in its earlier import, but the copy of its bill is the work
    of the import that re-opened it. Only that import may say it stopped with the bill still to copy, offer Resume,
    and list the bill when it could not be copied."""

    def _upload_killed_before_the_collect_bills(self) -> str:
        class _Killed(BaseException):
            pass

        with patch.object(cb, "store_collect_bills", side_effect=_Killed), self.assertRaises(_Killed):
            self._upload()
        frappe.db.rollback()
        new = frappe.get_all(
            "Outflow Import Batch", filters={"source": "Cashbook"}, order_by="creation desc", limit=1, pluck="name"
        )[0]
        self.batches.append(new)
        return new

    def test_only_the_reopening_import_waits_for_the_bill(self):
        new = self._upload_killed_before_the_collect_bills()
        self.assertFalse(self._only_line(COLLECT_WITH_LINK).stored_bill)

        old = cb.get_cashbook_status(self.old)
        self.assertEqual((old["bills_waiting"], old["stopped"]), (0, False))
        mine = cb.get_cashbook_status(new)
        self.assertEqual((mine["bills_waiting"], mine["stopped"]), (1, True))

    def test_only_the_reopening_import_lists_the_bill_it_could_not_copy(self):
        refused = _fake_bills({(COLLECT_WITH_LINK, "1.jpeg"): BillRefused("the server answered 403")})
        with self._clock(), patch.object(bills, "fetch_bill", refused), patch.object(
            cb, "_enqueue_worker", side_effect=lambda batch, actor, **kw: cb._cashbook_worker(batch, actor, **kw)
        ):
            new = _post(cb.confirm_cashbook_import, self.content, "statement.xlsx")["batch"]
        self.batches.append(new)

        txn = COLLECT_WITH_LINK + self.suffix
        self.assertNotIn(txn, {line["transfer_id"] for line in cb.get_cashbook_status(self.old)["bills_not_copied"]})
        self.assertIn(txn, {line["transfer_id"] for line in cb.get_cashbook_status(new)["bills_not_copied"]})


class TestReviewListsTheLinesToBeReopened(ReopenCase):
    def test_review_lists_each_line_with_the_import_that_holds_it(self):
        preview = self._preview()

        listed = {line["transfer_id"][: -len(self.suffix)]: line for line in preview["reopened"]}
        self.assertEqual(
            set(listed),
            {COLLECT_WITH_LINK, COLLECT_NO_LINK, COLLECT_FULL, REFUND_FULL, PART_REFUND, ADJUSTMENT, EARLIER_REFUND,
             WALLET_CREDIT},
        )
        self.assertEqual({line["earlier_batch"] for line in listed.values()}, {self.old})
        self.assertEqual(listed[COLLECT_FULL]["becomes"], "paired")
        self.assertEqual(listed[WALLET_CREDIT]["becomes"], "open")
        self.assertEqual(listed[WALLET_CREDIT]["amount"], 9000.0)
        self.assertFalse(preview["refused"])
