# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A Move to a project learns the remark's phrase, so the next Cashbook upload places it (#1758, spec #1753).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_cashbook_move_phrase

Seam: the Move write call (`rectify.rectify_lines`, its `phrase`), on the statement `CashbookRectifyCase` imports;
read back as the import reads it: the active `Outflow Import Project Alias` rows, and where the next upload of a
Cashbook statement places a line.

Each test learns a made-up phrase of its own ("vx <suffix>": a short word the token rules drop, as "vr" in "vr mall"),
and its clean-up removes the alias rows it named.
"""

import dataclasses
import json
import threading
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import rectify
from nirmaan_stack.api.outflow_import.rectify_phrase import learn_phrase
from nirmaan_stack.api.outflow_import.test_cashbook_bills import ONE_LINK, STATEMENT
from nirmaan_stack.api.outflow_import.test_cashbook_one_expense_race import _on_own_connection
from nirmaan_stack.api.outflow_import.test_cashbook_rectify import (
    NON_PROJECT_EXPENSE,
    PROJECT_EXPENSE,
    REASON,
    CashbookRectifyCase,
)
from nirmaan_stack.services.outflow_import.parser import parse_statement

ALIAS = "Outflow Import Project Alias"


class CashbookPhraseCase(CashbookRectifyCase):
    def setUp(self):
        super().setUp()
        self.phrase = f"vx {self.suffix.lower()}"
        self.addCleanup(self._forget, self.phrase)

    def _forget(self, phrase: str):
        frappe.db.rollback()
        for name in frappe.get_all(ALIAS, filters={"keyword": ["like", f"%{phrase.split()[-1]}%"]}, pluck="name"):
            try:
                frappe.delete_doc(ALIAS, name, force=True, ignore_permissions=True)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"cashbook phrase test purge: could not delete alias {name}")

    def _move_with(self, txns, project, phrase=None) -> dict:
        names = [self._line(t).name for t in txns]
        return rectify.rectify_lines(json.dumps(names), project or "", REASON, None, phrase)

    def _aliases(self) -> list:
        return frappe.get_all(
            ALIAS,
            filters={"keyword": ["like", f"%{self.suffix.lower()}%"]},
            fields=["keyword", "project", "active"],
        )


class TestAMoveToAProjectLearnsThePhrase(CashbookPhraseCase):
    def test_a_ticked_phrase_is_saved_as_an_active_alias_for_the_project(self):
        [line] = self._move_with([ONE_LINK], self.orchid, self.phrase)["lines"]

        self.assertTrue(line["rectified"], line)
        self.assertEqual(self._aliases(), [{"keyword": self.phrase, "project": self.orchid, "active": 1}])

    def test_unticked_no_phrase_is_saved(self):
        [line] = self._move_with([ONE_LINK], self.orchid, None)["lines"]

        self.assertTrue(line["rectified"], line)
        self.assertEqual(self._aliases(), [])

    def test_a_move_to_non_project_learns_nothing(self):
        self._move_with([ONE_LINK], self.orchid)

        [line] = self._move_with([ONE_LINK], None, self.phrase)["lines"]

        self.assertTrue(line["rectified"], line)
        self.assertEqual(self._expense(ONE_LINK).doctype, NON_PROJECT_EXPENSE)
        self.assertEqual(self._aliases(), [])

    def test_the_same_phrase_and_project_again_changes_nothing(self):
        self._move_with([ONE_LINK], self.orchid, self.phrase)
        self._move_with([ONE_LINK], self.lotus)

        # Typed differently, it is the same phrase as the import reads it.
        [line] = self._move_with([ONE_LINK], self.orchid, f"  VX-{self.suffix}  ")["lines"]

        self.assertTrue(line["rectified"], line)
        self.assertEqual(self._aliases(), [{"keyword": self.phrase, "project": self.orchid, "active": 1}])


class TestAPhraseNamingAnotherProjectIsRefused(CashbookPhraseCase):
    def test_the_write_is_refused_in_a_plain_sentence_and_nothing_moves(self):
        frappe.get_doc({"doctype": ALIAS, "keyword": self.phrase, "project": self.lotus, "active": 1}).insert(
            ignore_permissions=True
        )
        frappe.db.commit()
        old = self._expense(ONE_LINK)
        lotus_name = frappe.db.get_value("Projects", self.lotus, "project_name")

        with self.assertRaises(frappe.ValidationError) as refused:
            self._move_with([ONE_LINK], self.orchid, self.phrase.upper())

        frappe.db.rollback()
        self.assertEqual(
            frappe.utils.strip_html(str(refused.exception)),
            f"'{self.phrase}' already puts spends on {lotus_name}, and one phrase cannot name two projects. "
            "Change the phrase, or untick the box.",
        )
        self.assertEqual(self._expense(ONE_LINK).name, old.name)
        self.assertEqual(self._aliases(), [{"keyword": self.phrase, "project": self.lotus, "active": 1}])

    def test_a_retired_phrase_of_another_project_is_refused_too(self):
        frappe.get_doc({"doctype": ALIAS, "keyword": self.phrase, "project": self.lotus, "active": 0}).insert(
            ignore_permissions=True
        )
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            self._move_with([ONE_LINK], self.orchid, self.phrase)

        frappe.db.rollback()
        self.assertEqual(self._expense(ONE_LINK).doctype, NON_PROJECT_EXPENSE)


class TestTheNextUploadPlacesTheLearnedPhrase(CashbookPhraseCase):
    def test_a_remark_holding_the_phrase_lands_on_the_project(self):
        self._move_with([ONE_LINK], self.orchid, self.phrase)

        self._upload_again({ONE_LINK: f"Courier charges for {self.phrase.upper()} site"})

        expense = self._expense(ONE_LINK)
        self.assertEqual((expense.doctype, expense.projects), (PROJECT_EXPENSE, self.orchid))

    def test_without_the_phrase_learned_the_same_remark_stays_non_project(self):
        self._move_with([ONE_LINK], self.orchid)

        self._upload_again({ONE_LINK: f"Courier charges for {self.phrase.upper()} site"})

        self.assertEqual(self._expense(ONE_LINK).doctype, NON_PROJECT_EXPENSE)

    def _upload_again(self, remarks: dict) -> None:
        """Stage and run the fixture statement again as a new upload, under a fresh suffix and with these remarks,
        planned against the site's own aliases (the suite's expense rules). This test then reads that upload: its
        batch and suffix replace the first's, whose clean-up stays registered on the old values."""
        first = (self.batch, self.suffix)
        suffix = "U" + frappe.generate_hash(length=6).upper()
        parsed = parse_statement(STATEMENT.read_bytes(), source="Cashbook")
        parsed = dataclasses.replace(
            parsed,
            rows=[
                dataclasses.replace(r, transfer_id=r.transfer_id + suffix, remarks=remarks.get(r.transfer_id, r.remarks))
                for r in parsed.rows
            ],
        )
        with patch.object(cb, "load_expense_rules", lambda: self.expense_rules):
            batch = cb._stage(
                parsed, cb._build_plan(parsed), file_url="/private/files/test-statement-2.xlsx",
                filename="test-statement-2.xlsx", user="Administrator",
            ).name
        frappe.db.commit()
        self.batch, self.suffix = batch, suffix
        self.addCleanup(self._cleanup_upload, first)
        self._run()

    def _cleanup_upload(self, first):
        """The second upload's clean-up (the base's, on its batch), then the first's values back for the base's."""
        try:
            self._cleanup()
        finally:
            self.batch, self.suffix = first


class TestTwoMovesTeachingOnePhraseAtOnce(CashbookPhraseCase):
    """Two Moves on two connections teach one phrase (typed two ways) to two projects. The late one is already past
    its lines and into the learning (`rectify_phrase.learn_phrase`) with a snapshot taken before the early Move
    committed (the race driver of `test_cashbook_one_expense_race`)."""

    def test_the_late_one_saves_no_alias_and_says_why(self):
        early_rows = json.dumps([self._line(ONE_LINK).name])
        lotus, orchid, phrase, typed_otherwise = self.lotus, self.orchid, self.phrase, f"VX-{self.suffix}"
        lotus_name = frappe.db.get_value("Projects", lotus, "project_name")

        snapshot_taken, release = threading.Event(), threading.Event()
        late_out, early_out = {}, {}
        site = (frappe.local.site, frappe.local.sites_path)
        late = threading.Thread(
            target=_on_own_connection,
            args=(*site, lambda: learn_phrase(typed_otherwise, orchid), late_out, snapshot_taken, release),
        )
        late.start()
        try:
            self.assertTrue(snapshot_taken.wait(60), late_out.get("error"))
            early = threading.Thread(
                target=_on_own_connection,
                args=(*site, lambda: rectify.rectify_lines(early_rows, lotus, REASON, None, phrase), early_out),
            )
            early.start()
            early.join(300)
        finally:
            release.set()
            late.join(300)
        self.assertNotIn("error", early_out, early_out.get("error"))
        self.assertNotIn("error", late_out, late_out.get("error"))

        frappe.db.rollback()
        self.assertEqual(self._aliases(), [{"keyword": phrase, "project": lotus, "active": 1}])
        self.assertEqual(
            late_out["result"],
            {
                "phrase": typed_otherwise,
                "saved": False,
                "reason": f"'{phrase}' already puts spends on {lotus_name}, and one phrase cannot name two projects. "
                "Change the phrase, or untick the box.",
            },
        )
