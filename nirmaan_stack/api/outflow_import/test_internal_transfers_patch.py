# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The one-time patch turns old skipped lines into Internal Transfers (#1627, spec #1619).

Seeds old Skipped lines of every moved kind, plus the lines that must stay as they are, and runs the patch's
conversion twice -- scoped to the seeded lines, so the env's own data is never touched.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Every batch, row and record this suite makes is purged.
"""

import frappe

from nirmaan_stack.api.outflow_import.internal_transfers import INTERNAL_TRANSFER_DOCTYPE
from nirmaan_stack.api.outflow_import.test_internal_transfer_status import InternalTransferLineFixture
from nirmaan_stack.api.outflow_import.upload import ROW_DOCTYPE
from nirmaan_stack.patches.v3_0.internal_transfers_from_old_skips import convert_old_skips

ICICI = "ICICI Bank Statement"
CARD = "ICICI Credit Card Statement"


class TestTheOldSkipsPatch(InternalTransferLineFixture):

    def _old(self, batch, kind, *, source=ICICI, remarks="", direction="Debit", transfer_id=None, row_kind=None,
             status="SUCCESS", amount=1000.0, who_from="", who_to=""):
        name = self._line(batch, status="Skipped", direction=direction, amount=amount, source=source)
        values = {"skip_kind": kind, "skip_origin": "System", "skip_reason": "an old skip", "remarks": remarks,
                  "row_kind": row_kind, "status_raw": status, "added_by_raw": who_from, "beneficiary_name": who_to}
        if transfer_id:
            values["transfer_id"] = transfer_id
        frappe.db.set_value(ROW_DOCTYPE, name, values, update_modified=False)
        frappe.db.commit()
        return name

    def _state(self, name):
        line = frappe.db.get_value(ROW_DOCTYPE, name, ["row_status", "skip_kind"], as_dict=True)
        records = frappe.get_all(INTERNAL_TRANSFER_DOCTYPE, filters={"import_row": name},
                                 fields=["from_place", "to_place", "detail", "made_by"])
        return line.row_status, line.skip_kind, [(r.from_place, r.to_place, r.detail, r.made_by) for r in records]

    def _seed(self):
        icici, cashbook, card = self._batch(), self._batch(source="Cashbook"), self._batch(source=CARD)
        tag = frappe.generate_hash(length=6).upper()
        cb = dict(source="Cashbook", direction="")
        return {
            "cashfree": self._old(icici, "Cashfree wallet top-up", remarks="MMT/IMPS/600900000001/TESTWALLETA/IDFB0020101"),
            "gl_in": self._old(icici, "Bank internal transfer", remarks="Ac xfr from gl 01234 to 56789", direction="Credit"),
            "bounced_wallet": self._old(icici, "Failed payment bounced back", direction="Credit",
                                        remarks="NEFT-RETURN-TESTREF0011-CASHBOOK TOPUP"),
            "bounced_vendor": self._old(icici, "Failed payment bounced back", direction="Credit",
                                        remarks="NEFT-RETURN-TESTREF0012-TESTVENDOR"),
            "misread": self._old(icici, "Porter wallet top-up", remarks="NEFT/TESTSUPPLIER STEEL/UTIB0000001"),
            "already": self._old(icici, "Already imported", remarks="MMT/IMPS/600900000009/TESTWALLETA/IDFB0020101"),
            "vaload": self._old(cashbook, "Cashbook internal movement", transfer_id=f"VALOAD-{tag}1", **cb),
            "business": self._old(cashbook, "Cashbook internal movement", transfer_id=f"BUSINESS_USER-{tag}-0",
                                  who_to="Test Employee A", **cb),
            "c2b": self._old(cashbook, "Cashbook internal movement", transfer_id=f"C2B-BUSINESS_USER-{tag}",
                             who_from="Test Employee B", **cb),
            "typed": self._old(cashbook, "Cashbook internal movement", transfer_id=f"OBO{tag}9", row_kind="Bank → VA",
                               **cb),
            "refund": self._old(cashbook, "Cashbook internal movement", transfer_id=f"REF-{tag}", **cb),
            "unplaceable": self._old(cashbook, "Cashbook internal movement", transfer_id=f"TESTUPI{tag}", **cb),
            "failed_move": self._old(cashbook, "Cashbook internal movement", transfer_id=f"VALOAD-{tag}2",
                                     status="FAILED", **cb),
            "autodebit": self._old(card, "Card payment received", source=CARD, direction="Credit",
                                   remarks="Autodebit Payment Recd."),
            "upi": self._old(card, "Card payment received", source=CARD, direction="Credit",
                             remarks="UPI Payment Received"),
        }

    _original_kind = {
        "bounced_vendor": "Failed payment bounced back",
        "refund": "Cashbook internal movement", "upi": "Card payment received",
        "failed_move": "Cashbook internal movement", "misread": "Porter wallet top-up",
        "unplaceable": "Cashbook internal movement",
    }

    def test_every_moved_kind_is_converted_and_every_other_skip_is_left(self):
        lines = self._seed()
        report = convert_old_skips(rows=list(lines.values()))
        frappe.db.commit()
        IT = "Internal Transfer"
        expected = {
            "cashfree": (IT, None, [("ICICI Current Account", "Cashfree Wallet", None, "platform_cashfree")]),
            "gl_in": (IT, None, [("ICICI Bank Ledger", "ICICI Current Account", "GL 01234 to 56789",
                                  "internal_gl_transfer_in")]),
            "bounced_wallet": (IT, None, [("Cashbook Virtual Account", "ICICI Current Account", None,
                                           "neft_return_failed")]),
            "bounced_vendor": ("Skipped", "Failed payment bounced back", []),
            "misread": ("Skipped", "Porter wallet top-up", []),
            "already": ("Skipped", "Already imported", []),
            "vaload": (IT, None, [("ICICI Current Account", "Cashbook Virtual Account", None, "cashbook_bank_to_va")]),
            "business": (IT, None, [("Cashbook Virtual Account", "Cashbook Employee Wallet", "Test Employee A",
                                     "cashbook_va_to_wallet")]),
            "c2b": (IT, None, [("Cashbook Employee Wallet", "Cashbook Virtual Account", "Test Employee B",
                                "cashbook_wallet_to_va")]),
            "typed": (IT, None, [("ICICI Current Account", "Cashbook Virtual Account", None, "cashbook_bank_to_va")]),
            "refund": ("Skipped", "Cashbook internal movement", []),
            "unplaceable": ("Skipped", "Cashbook internal movement", []),
            # Owner decision 3 (#1619): a failed Cashbook move is Bank refused, in the patch as in the import.
            "failed_move": ("Skipped", "Bank refused", []),
            "autodebit": (IT, None, [("ICICI Current Account", "ICICI Credit Card", None, "card_auto_debit")]),
            "upi": ("Skipped", "Card payment received", []),
        }
        for key, want in expected.items():
            with self.subTest(line=key):
                self.assertEqual(self._state(lines[key]), want)
        self.assertEqual(report.converted, 8)
        # It prints every line it could not place, with its kind and why.
        unplaced = {line: (kind, why) for line, kind, why in report.unplaced}
        self.assertEqual(set(unplaced), {lines["misread"], lines["unplaceable"]})
        self.assertEqual(unplaced[lines["misread"]][0], "Porter wallet top-up")
        self.assertIn("Txn Id", unplaced[lines["unplaceable"]][1])
        self.assertIn(lines["unplaceable"], report.text())
        # Review finding (#1619): it prints every line it leaves too, one per line, with its kind and why -- the
        # failed Cashbook moves it now re-files as Bank refused included.
        text = report.text().splitlines()
        # (A line of any other Skip Type, "already" here, is not read at all.)
        for key in ("bounced_vendor", "refund", "upi", "failed_move", "misread", "unplaceable"):
            with self.subTest(printed=key):
                printed = [row for row in text if lines[key] in row]
                self.assertEqual(len(printed), 1, printed)
                self.assertIn(self._original_kind[key], printed[0])
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, lines["failed_move"], "skip_reason"), "Did not succeed at the wallet"
        )

    def test_a_second_run_makes_no_second_record_and_changes_nothing(self):
        lines = self._seed()
        convert_old_skips(rows=list(lines.values()))
        frappe.db.commit()
        before = {key: self._state(name) for key, name in lines.items()}
        again = convert_old_skips(rows=list(lines.values()))
        frappe.db.commit()
        self.assertEqual(again.converted, 0)
        self.assertEqual({key: self._state(name) for key, name in lines.items()}, before)

    def test_a_status_changed_repeat_of_a_cashbook_move_makes_no_second_record(self):
        batch = self._batch(source="Cashbook")
        tag = frappe.generate_hash(length=6).upper()
        first = self._old(batch, "Cashbook internal movement", source="Cashbook", direction="",
                          transfer_id=f"VALOAD-{tag}", amount=0.0)
        repeat = self._old(batch, "Cashbook internal movement", source="Cashbook", direction="",
                           transfer_id=f"VALOAD-{tag}", amount=0.0)
        convert_old_skips(rows=[first, repeat])
        frappe.db.commit()
        self.assertEqual([self._state(first)[0], self._state(repeat)[0]], ["Internal Transfer"] * 2)
        self.assertEqual(len(self._state(first)[2]) + len(self._state(repeat)[2]), 1)

    def test_a_failed_repeat_of_a_recorded_move_is_filed_as_the_import_files_it(self):
        """Code review (#1619): the patch and the import agree. A REVERSED sighting of a move whose SUCCESS line holds
        the record is an Internal Transfer line with no record; a failed move with no recorded sighting is Bank
        refused."""
        batch = self._batch(source="Cashbook")
        tag = frappe.generate_hash(length=6).upper()
        moved = self._old(batch, "Cashbook internal movement", source="Cashbook", direction="",
                          transfer_id=f"VALOAD-{tag}", amount=0.0)
        reversed_later = self._old(self._batch(source="Cashbook"), "Cashbook internal movement", source="Cashbook",
                                   direction="", transfer_id=f"VALOAD-{tag}", amount=0.0, status="REVERSED")
        report = convert_old_skips(rows=[moved, reversed_later])
        frappe.db.commit()
        self.assertEqual(self._state(moved)[:2], ("Internal Transfer", None))
        self.assertEqual(len(self._state(moved)[2]), 1)
        self.assertEqual(self._state(reversed_later), ("Internal Transfer", None, []))
        self.assertEqual(report.refused, [])
