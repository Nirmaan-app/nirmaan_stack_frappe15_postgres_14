"""Monthly asset audit (owner, 2026-10-14) -- opening, sending, the category switch, who sees what.

- An audit opens for an assigned asset whose category needs one: on the 28th (next month's, for everyone up
  to date), on the 7th (this month's, for whoever sent last month's in the grace days), at handover
  (declaration arrives), and when its category is ticked -- from the 28th, for the next month.
- The 7th records last month's unsent audit Missed and moves it to this month (`audit_overdue_since` keeps the
  first missed month until an audit is sent), or closes it when the category is no longer audited.
- One open audit at a time; never twice for a month; not again after handover when the asset was already
  audited for that month (the month it was for, not the day sent); a leftover row is never audited. A
  `returned` flag left on a row (returns were removed, 2026-10-26) no longer stops it.
- Only the holder sends it: "Is it working?" (owner, 2026-10-21) -- "Yes" with optional remarks and no photo, "No"
  with a required description and an optional image, which must be their own unattached upload. The answers are
  saved on the assignment (latest only) and on the history row; the asset's condition is left alone (the answers
  show any issue).
- Admin / HR unassign always, even while an audit is Pending.
- Only Admin switches a category; unticking keeps open audits.
- PMO and procurement read the audit rows from the history, nothing else there.

People are bare User + Nirmaan Users rows (plus a Role where a DocPerm is exercised). The sweeping calls (the
28th and 7th runs) keep their real queries and are filtered to this suite's assets. Nothing commits.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_audits
"""

import json
from contextlib import ExitStack
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_months, getdate, now_datetime, today

from nirmaan_stack.api.assets import audits as audits_api
from nirmaan_stack.api.assets.assign import unassign_asset
from nirmaan_stack.api.assets.history import get_asset_history
from nirmaan_stack.patches.v3_0.remove_asset_returns import remove_returns
from nirmaan_stack.nirmaan_stack.doctype.asset_management.test_asset_management import (
    CATEGORY_PREFIX,
    FAKE_FILE_URL,
    _make_person,
    _purge,
    ensure_departments,
)
from nirmaan_stack.services import asset_audit_open
from nirmaan_stack.services.asset_audit import audit_month_label, cycle_month
from nirmaan_stack.services.asset_audit_open import open_due_audits
from nirmaan_stack.tasks import asset_audit as audit_tasks
from nirmaan_stack.tasks.asset_audit import close_last_month_audits, open_next_month_audits

PM = "Nirmaan Project Manager Profile"

# The dialog's one question (frontend/src/utils/assetAuditQuestions.ts; owner, 2026-10-21), for every asset.
QUESTION_ID, QUESTION = "working", "Is it working?"
YES, NO = "Yes, it is working", "No, it is not working"


def _answer(problem=None):
    """One answer as the dialog sends it: "Yes", or "No" with `problem` as its description."""
    if problem is None:
        return {"id": QUESTION_ID, "q": QUESTION, "a": YES}
    return {"id": QUESTION_ID, "q": QUESTION, "a": NO, "flag": 1, "text": problem}


class TestMonthlyAssetAudit(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        cls.departments = ensure_departments("Projects")
        cls.created_categories = []
        cls.holder = _make_person("aud-holder", PM, "Projects")
        cls.holder2 = _make_person("aud-holder2", PM, "Projects")
        cls.stranger = _make_person("aud-stranger", PM, "Projects")
        cls.hr = _make_person("aud-hr", "Nirmaan HR Executive Profile", "Projects")
        cls.pmo = _make_person("aud-pmo", "Nirmaan PMO Executive Profile", "Projects")
        cls.procurement = _make_person("aud-proc", "Nirmaan Procurement Executive Profile", "Projects")
        cls.hr_lead = _make_person("aud-hrlead", "Nirmaan HR Lead Profile", "Projects")
        cls.admin = _make_person("aud-admin", "Nirmaan Admin Profile", "Projects")
        # HR Lead's Role carries Asset Category write, but the profile may not switch the audit.
        frappe.get_doc({
            "doctype": "Has Role", "name": frappe.generate_hash(length=10), "parent": cls.hr_lead,
            "parenttype": "User", "parentfield": "roles", "role": "Nirmaan HR Lead",
        }).db_insert()
        frappe.clear_cache(user=cls.hr_lead)
        cls.people = [cls.holder, cls.holder2, cls.stranger, cls.hr, cls.pmo, cls.procurement, cls.hr_lead, cls.admin]
        cls.assets = []

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        frappe.db.delete("Has Role", {"parent": ["in", cls.people], "parenttype": "User"})
        frappe.db.commit()
        for category in cls.created_categories or ["__none__"]:
            _purge(category, cls.assets or ["__none__"], cls.people, cls.departments)
        super().tearDownClass()

    def setUp(self):
        self.commit = patch("frappe.db.commit")  # the endpoints commit; keep everything in the rollback
        self.commit.start()
        # The month an audit opened today is for (from the 28th, the next one), and the runs around it.
        self.cycle = cycle_month(getdate())
        self.month = audit_month_label(self.cycle)
        self.next_month_day = add_months(self.cycle, 1)  # its 1st
        self.next_month = audit_month_label(self.next_month_day)
        self.the_28th = str(self.cycle.replace(day=28))  # opens next month's for everyone up to date
        self.the_7th = str(self.cycle.replace(day=7))  # this cycle month's 7th
        self.next_7th = str(self.next_month_day.replace(day=7))  # this month's unsent are recorded Missed
        # FrappeTestCase keeps one transaction for the class: earlier tests' rows are still there, so each
        # test gets its own categories and the sweeps see only its own assets.
        self.mine = []
        self.categories = {key: self._category(kind, audited) for key, kind, audited in (
            ("project", "Project", 1), ("it", "IT", 1), ("chair", "IT", 0),
        )}

    def tearDown(self):
        self.commit.stop()
        frappe.set_user("Administrator")

    # -- helpers --------------------------------------------------------------------------------

    def _category(self, kind, audited):
        frappe.set_user("Administrator")
        name = f"{CATEGORY_PREFIX} Audit {kind} {frappe.generate_hash(length=8)}"
        frappe.get_doc({
            "doctype": "Asset Category", "asset_category": name, "category_type": kind, "audit_required": audited,
        }).insert(ignore_permissions=True)
        self.created_categories.append(name)
        return name

    def _asset(self, category="project"):
        frappe.set_user("Administrator")
        asset = frappe.get_doc({
            "doctype": "Asset Master", "asset_name": f"Audit test {category}", "asset_condition": "Good",
            "asset_category": self.categories[category], "department": "Projects",
        }).insert(ignore_permissions=True).name
        self.assets.append(asset)
        self.mine.append(asset)
        return asset

    def _assign(self, category="project", person=None, declaration=True, asset=None):
        """Assign an asset (a new one unless given) with a declaration on file unless told otherwise."""
        frappe.set_user("Administrator")
        asset = asset or self._asset(category)
        row = frappe.get_doc({
            "doctype": "Asset Management", "asset": asset, "asset_assigned_to": person or self.holder,
            "asset_assigned_on": today(),
            "asset_declaration_attachment": FAKE_FILE_URL.format(asset, asset) if declaration else None,
        }).insert(ignore_permissions=True)
        return asset, row.name

    def _photo(self, owner=None, file_name="proof.jpg", attached_to=None):
        """An uploaded photo File, as Frappe's upload leaves it (private, attached to nothing)."""
        name = frappe.generate_hash(length=10)
        doc = frappe.new_doc("File")
        doc.update({
            "name": name, "file_name": file_name, "is_private": 1, "owner": owner or self.holder,
            "file_url": f"/api/method/frappe_gcp_attachment.controller.generate_file?key=test-dept/{name}&file_name={file_name}",
            "creation": now_datetime(), "modified": now_datetime(),
        })
        if attached_to:
            doc.attached_to_doctype, doc.attached_to_name = attached_to
        doc.db_insert()
        return doc.file_url

    def _row_asset(self, assignment):
        return frappe.db.get_value("Asset Management", assignment, "asset")

    def _row(self, assignment):
        return frappe.db.get_value(
            "Asset Management", assignment,
            ["audit_status", "audit_month", "last_audit_on", "audit_proof", "audit_overdue_since", "audit_answers"],
            as_dict=True,
        )

    def _history(self, asset, event=None):
        filters = {"parent": asset, "parenttype": "Asset Master"}
        if event:
            filters["event"] = event
        return frappe.get_all(
            "Asset History", filters=filters, fields=["event", "reason", "declaration", "done_by", "audit_answers"],
            order_by="idx"
        )

    def _answers(self, problem=None):
        """The `answers` argument as the dialog sends it: "Yes", or "No" with `problem` as its description."""
        return json.dumps([_answer(problem)])

    def _submit(self, assignment, remarks=None, photo=None, user=None, answers=None):
        """Send the audit as the dialog does: "Yes" with no photo, unless told otherwise."""
        frappe.set_user(user or self.holder)
        return audits_api.submit_audit(
            assignment, photo, remarks, answers if answers is not None else self._answers()
        )

    def _scoped(self):
        """Keep the real selection queries; drop every row that isn't this test's (the live DB)."""
        due = asset_audit_open.due_assignments
        earlier = asset_audit_open.open_audits_from_earlier_months
        stack = ExitStack()
        stack.enter_context(patch.object(
            asset_audit_open, "due_assignments",
            side_effect=lambda day, **kw: [r for r in due(day, **kw) if r.asset in self.mine],
        ))
        stack.enter_context(patch.object(
            asset_audit_open, "open_audits_from_earlier_months",
            side_effect=lambda day: [r for r in earlier(day) if r.asset in self.mine],
        ))
        return stack

    # -- opening --------------------------------------------------------------------------------

    def test_a_signed_handover_in_an_audited_category_opens_this_months_audit(self):
        asset, assignment = self._assign()
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_month), ("Pending", self.month))
        created = self._history(asset, "Audit Requested")
        self.assertEqual([r.reason for r in created], [f"{self.month} · handover"])

    def test_a_handover_from_the_28th_opens_next_months_audit(self):
        with self.freeze_time(f"{self.the_28th} 10:00:00"):
            asset, assignment = self._assign()
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_month), ("Pending", self.next_month))
        self.assertEqual([r.reason for r in self._history(asset, "Audit Requested")], [f"{self.next_month} · handover"])

    def test_an_unaudited_category_never_opens_one(self):
        asset, assignment = self._assign("chair")
        self.assertFalse(self._row(assignment).audit_status)
        self.assertEqual(open_due_audits(assignment=assignment), [])
        self.assertEqual(open_due_audits(day=self.next_month_day, assignment=assignment), [])
        self.assertEqual(self._history(asset, "Audit Requested"), [])

    def test_no_declaration_no_audit_until_it_arrives(self):
        asset, assignment = self._assign(declaration=False)
        self.assertFalse(self._row(assignment).audit_status)
        self.assertEqual(open_due_audits(assignment=assignment), [])  # the cron skips it too
        doc = frappe.get_doc("Asset Management", assignment)
        doc.asset_declaration_attachment = FAKE_FILE_URL.format(asset, "later")
        doc.save(ignore_permissions=True)
        self.assertEqual(self._row(assignment).audit_status, "Pending")

    def test_an_open_audit_is_never_doubled_within_its_month(self):
        asset, assignment = self._assign()
        self.assertEqual(open_due_audits(assignment=assignment), [])
        self.assertEqual(open_due_audits(day=self.next_month_day, assignment=assignment), [])  # open: not due
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_month), ("Pending", self.month))
        self.assertEqual(len(self._history(asset, "Audit Requested")), 1)

    def test_the_28th_opens_next_month_for_those_up_to_date_and_leaves_the_rest_their_grace(self):
        _, sent = self._assign()
        _, behind = self._assign(person=self.holder2)
        self._submit(sent)
        frappe.set_user("Administrator")
        with self._scoped():
            self.assertEqual(open_next_month_audits(day=self.the_28th), {"opened": [sent]})
        row = self._row(sent)
        self.assertEqual((row.audit_status, row.audit_month), ("Pending", self.next_month))
        self.assertEqual(self._history(self._row_asset(sent), "Audit Requested")[-1].reason, self.next_month)
        # still behind: untouched, nothing recorded, not overdue -- the grace days run to the 7th
        row = self._row(behind)
        self.assertEqual((row.audit_status, row.audit_month, row.audit_overdue_since), ("Pending", self.month, None))
        self.assertEqual(self._history(self._row_asset(behind), "Audit Missed"), [])

    def test_on_the_7th_an_unsent_audit_is_missed_and_moved_to_the_new_month(self):
        """Owner, 2026-10-14: every month ends Fulfilled or Missed; the same open audit becomes this month's."""
        asset, assignment = self._assign()
        with self._scoped():
            result = close_last_month_audits(day=self.next_7th)
            self.assertEqual((result["missed"], result["moved"], result["opened"]), ([assignment], [assignment], []))
            self.assertEqual(close_last_month_audits(day=self.next_7th)["missed"], [])  # twice: once
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_month), ("Pending", self.next_month))
        self.assertEqual(row.audit_overdue_since, self.month)
        events = [(r.event, r.reason) for r in self._history(asset) if r.event.startswith("Audit")]
        self.assertEqual(events, [
            ("Audit Requested", f"{self.month} · handover"),
            ("Audit Missed", self.month),
            ("Audit Requested", self.next_month),
        ])

    def test_a_grace_day_sender_gets_this_months_audit_on_the_7th(self):
        asset, assignment = self._assign()
        with self._scoped():
            self.assertEqual(open_next_month_audits(day=self.the_28th)["opened"], [])  # behind on the 28th
        self._submit(assignment)  # sent during the grace days: it is for the month it was open for
        frappe.set_user("Administrator")
        self.assertIn(f"for {self.month}", self._history(asset, "Audit Fulfilled")[-1].reason)
        with self._scoped():
            result = close_last_month_audits(day=self.next_7th)
        self.assertEqual((result["missed"], result["opened"]), ([], [assignment]))
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_month, row.audit_overdue_since), ("Pending", self.next_month, None))
        self.assertEqual(self._history(asset, "Audit Missed"), [])

    def test_overdue_since_keeps_the_first_missed_month_until_an_audit_is_sent(self):
        asset, assignment = self._assign()
        month_after = add_months(self.cycle, 2)
        with self._scoped():
            close_last_month_audits(day=self.next_7th)
            close_last_month_audits(day=str(month_after.replace(day=7)))
        row = self._row(assignment)
        self.assertEqual((row.audit_month, row.audit_overdue_since), (audit_month_label(month_after), self.month))
        self.assertEqual([r.reason for r in self._history(asset, "Audit Missed")], [self.month, self.next_month])
        self._submit(assignment)
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_overdue_since), ("Fulfilled", None))
        self.assertEqual(len(self._history(asset, "Audit Missed")), 2)  # the history keeps them
        self.assertIn(f"for {audit_month_label(month_after)}", self._history(asset, "Audit Fulfilled")[-1].reason)

    def test_an_audit_for_a_later_month_is_never_recorded_missed(self):
        """A month ahead (typed in Desk, or left by a run 'as if' a later day) is not "earlier": left alone."""
        asset, assignment = self._assign()
        frappe.db.set_value("Asset Management", assignment, "audit_month", self.next_month)
        with self._scoped():
            self.assertEqual(close_last_month_audits(day=self.the_7th)["missed"], [])
        self.assertEqual(self._row(assignment).audit_month, self.next_month)
        self.assertEqual(self._history(asset, "Audit Missed"), [])

    def test_on_the_7th_an_unsent_audit_of_a_category_no_longer_audited_is_missed_and_closed(self):
        asset, assignment = self._assign("it")
        with self._scoped():
            close_last_month_audits(day=self.next_7th)  # missed once: overdue since this month
        self.assertEqual(self._row(assignment).audit_overdue_since, self.month)
        frappe.db.set_value("Asset Category", self.categories["it"], "audit_required", 0)  # switched off mid-cycle
        self.assertEqual(self._row(assignment).audit_status, "Pending")  # mid-cycle it stays
        with self._scoped():
            result = close_last_month_audits(day=str(add_months(self.cycle, 2).replace(day=7)))
        self.assertEqual((result["missed"], result["closed"], result["moved"]), ([assignment], [assignment], []))
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_overdue_since), (None, None))
        self.assertEqual([r.event for r in self._history(asset) if r.event.startswith("Audit")][-1], "Audit Missed")

    def test_sent_this_month_is_not_opened_again_this_month_but_is_next_month(self):
        asset, assignment = self._assign()
        self._submit(assignment)
        frappe.set_user("Administrator")
        self.assertEqual(open_due_audits(assignment=assignment), [])
        self.assertEqual(open_due_audits(day=self.next_month_day, assignment=assignment), [assignment])
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_month), ("Pending", audit_month_label(self.next_month_day)))
        self.assertEqual(self._history(asset, "Audit Requested")[-1].reason, audit_month_label(self.next_month_day))

    def _old_history_row(self, asset, event, assigned_to, reason=None):
        """A history row as the removed return feature (or its rejection's audit) left it."""
        frappe.get_doc({
            "doctype": "Asset History", "name": frappe.generate_hash(length=10), "parent": asset,
            "parenttype": "Asset Master", "parentfield": "asset_history", "idx": 900 + len(self._history(asset)),
            "event": event, "assigned_to": assigned_to, "done_by": assigned_to, "done_on": now_datetime(),
            "reason": reason,
        }).db_insert()

    def test_the_patch_removes_returns_and_their_history(self):
        """Returns were removed (2026-10-26): a waiting return is cancelled (the person keeps the asset, an owed
        audit opens), every return history row goes, and an audit's "return rejected" note is dropped."""
        asset, assignment = self._assign("chair")
        unaudited_asset, unaudited = self._assign("project", person=self.holder2)
        frappe.db.set_value("Asset Category", self.categories["chair"], "audit_required", 1)  # no hook: nothing opened
        frappe.db.set_value("Asset Category", self.categories["project"], "audit_required", 0)
        for row in (assignment, unaudited):
            frappe.db.set_value("Asset Management", row, {"returned": 1, "returned_on": "2026-10-14", "audit_status": None})
        self._old_history_row(asset, "Return Requested", self.holder)
        self._old_history_row(asset, "Return Rejected", self.holder, "Return of 13-10-2026")
        self._old_history_row(unaudited_asset, "Return Requested", self.holder2)
        self._old_history_row(unaudited_asset, "Audit Requested", self.holder2, "09/2026 · return rejected")
        self._old_history_row(unaudited_asset, "Unassigned", self.holder2, "Returned – no longer needed")  # an approval
        kept = [(r.event, r.reason) for r in self._history(asset) if not r.event.startswith("Return")]

        result = remove_returns(assets=[asset, unaudited_asset])
        self.assertEqual(result, {
            "cancelled": sorted([assignment, unaudited]), "audits_opened": [assignment],
            "history_deleted": 3, "notes_trimmed": 1,
        })
        for row, held, person in ((assignment, asset, self.holder), (unaudited, unaudited_asset, self.holder2)):
            self.assertEqual(frappe.db.get_value("Asset Management", row, ["returned", "returned_on"]), (0, None))
            self.assertEqual(frappe.db.get_value("Asset Master", held, "current_assignee"), person)
            self.assertEqual([r for r in self._history(held) if r.event.startswith("Return")], [])
        self.assertEqual(self._row(assignment).audit_status, "Pending")
        self.assertEqual(self._history(asset, "Audit Requested")[-1].reason, self.month)  # no note mentions a return
        self.assertFalse(self._row(unaudited).audit_status)  # its category isn't audited
        self.assertEqual(self._history(unaudited_asset, "Audit Requested")[-1].reason, "09/2026")
        self.assertEqual(self._history(unaudited_asset, "Unassigned")[-1].reason, "Returned – no longer needed")
        self.assertEqual([(r.event, r.reason) for r in self._history(asset)][: len(kept)], kept)  # the rest untouched
        again = remove_returns(assets=[asset, unaudited_asset])  # twice: once
        self.assertEqual((again["cancelled"], again["history_deleted"], again["notes_trimmed"]), ([], 0, 0))

    def test_a_leftover_row_for_someone_else_is_never_audited(self):
        asset, _ = self._assign("chair")  # held by holder
        leftover = frappe.new_doc("Asset Management")
        leftover.update({
            "name": frappe.generate_hash(length=10), "asset": asset, "asset_assigned_to": self.holder2,
            "asset_assigned_on": today(), "asset_declaration_attachment": FAKE_FILE_URL.format(asset, "old"),
            "creation": now_datetime(), "modified": now_datetime(), "owner": "Administrator",
        })
        leftover.db_insert()
        frappe.db.set_value("Asset Category", self.categories["chair"], "audit_required", 1)
        self.assertEqual(open_due_audits(assignment=leftover.name), [])

    def test_after_a_handover_an_asset_audited_this_month_waits_for_the_next_month(self):
        asset, first = self._assign()
        self._submit(first)
        frappe.set_user("Administrator")
        unassign_asset(asset, "Handing over to another person")
        _, second = self._assign(person=self.holder2, asset=asset)
        self.assertFalse(self._row(second).audit_status)
        self.assertEqual(open_due_audits(day=self.next_month_day, assignment=second), [second])

    def test_already_audited_goes_by_the_month_it_was_for(self):
        """Next month's audit sent early (opened on the 28th): a new holder isn't asked for that month again."""
        asset, first = self._assign()
        self._submit(first)
        frappe.set_user("Administrator")
        with self._scoped():
            self.assertEqual(open_next_month_audits(day=self.the_28th)["opened"], [first])
        self._submit(first)  # for next month
        frappe.set_user("Administrator")
        unassign_asset(asset, "Handing over to another person")
        _, second = self._assign(person=self.holder2, asset=asset)
        self.assertFalse(self._row(second).audit_status)
        self.assertEqual(open_due_audits(day=self.the_28th, assignment=second), [])
        self.assertEqual(open_due_audits(day=add_months(self.cycle, 2), assignment=second), [second])

    def test_running_the_same_open_twice_writes_one_history_row(self):
        asset, assignment = self._assign("chair")
        frappe.db.set_value("Asset Category", self.categories["chair"], "audit_required", 1)
        self.assertEqual(open_due_audits(assignment=assignment), [assignment])
        self.assertEqual(open_due_audits(assignment=assignment), [])
        self.assertFalse(asset_audit_open._mark_pending(assignment, self.month))
        self.assertEqual(len(self._history(asset, "Audit Requested")), 1)

    # -- sending --------------------------------------------------------------------------------

    def test_not_working_sends_its_description_and_image_and_the_condition_is_left_alone(self):
        asset, assignment = self._assign()
        photo = self._photo()
        result = self._submit(assignment, photo=photo, answers=self._answers("Screen cracked"))
        self.assertEqual(result, {"assignment": assignment, "audit_status": "Fulfilled"})
        row = self._row(assignment)
        self.assertEqual((row.audit_status, str(row.last_audit_on), row.audit_proof), ("Fulfilled", today(), photo))
        self.assertEqual(frappe.db.get_value("Asset Master", asset, "asset_condition"), "Good")  # "not working" or not
        fulfilled = self._history(asset, "Audit Fulfilled")
        self.assertEqual(len(fulfilled), 1)
        self.assertEqual(fulfilled[0].reason, f"for {self.month}")
        self.assertEqual((fulfilled[0].declaration, fulfilled[0].done_by), (photo, self.holder))
        file = frappe.db.get_value(
            "File", {"file_url": photo}, ["attached_to_doctype", "attached_to_name", "attached_to_field"], as_dict=True
        )
        self.assertEqual(tuple(file.values()), ("Asset Management", assignment, "audit_proof"))

    def test_working_needs_no_photo_and_its_remarks_are_optional(self):
        """Owner, 2026-10-21: a working asset needs no image at all."""
        asset, assignment = self._assign()
        self._submit(assignment)
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_proof), ("Fulfilled", None))
        fulfilled = self._history(asset, "Audit Fulfilled")
        self.assertEqual((fulfilled[0].reason, fulfilled[0].declaration), (f"for {self.month}", None))

        other_asset, other = self._assign("it")
        self._submit(other, "Kept in the site store")
        self.assertEqual(self._history(other_asset, "Audit Fulfilled")[0].reason, f"for {self.month} · Kept in the site store")

    def test_not_working_without_a_description_is_refused_and_changes_nothing(self):
        asset, assignment = self._assign()
        photo = self._photo()
        frappe.set_user(self.holder)
        for blank in ("", "   "):
            with self.assertRaisesRegex(frappe.ValidationError, 'Describe the problem under "No, it is not working"'):
                audits_api.submit_audit(assignment, photo, None, json.dumps([_answer(blank)]))
        no_text = {key: value for key, value in _answer("x").items() if key != "text"}
        with self.assertRaisesRegex(frappe.ValidationError, "Describe the problem"):
            audits_api.submit_audit(assignment, None, None, json.dumps([no_text]))
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_proof, row.audit_answers), ("Pending", None, None))
        self.assertFalse(frappe.db.get_value("File", {"file_url": photo}, "attached_to_name"))  # image not claimed
        self.assertEqual(self._history(asset, "Audit Fulfilled"), [])

    def test_only_the_holder_can_send_it(self):
        _, assignment = self._assign()
        for user in (self.stranger, "Administrator", self.hr):
            with self.assertRaises(frappe.PermissionError, msg=user):
                self._submit(assignment, user=user)
        self.assertEqual(self._row(assignment).audit_status, "Pending")

    def test_refused_submits_change_nothing(self):
        _, open_row = self._assign()
        _, no_audit = self._assign("chair")
        with self.assertRaisesRegex(frappe.ValidationError, "no audit waiting"):
            self._submit(no_audit)
        self.assertEqual(self._row(open_row).audit_status, "Pending")
        frappe.set_user(self.holder)
        audits_api.submit_audit(open_row, "  ", None, self._answers())  # a blank image is no image
        self.assertEqual(self._row(open_row).audit_proof, None)
        with self.assertRaisesRegex(frappe.ValidationError, "already submitted"):
            self._submit(open_row)

    def test_only_the_callers_own_unattached_photo_is_claimed(self):
        asset, assignment = self._assign()
        frappe.set_user(self.holder)
        others = self._photo(owner=self.stranger)
        attached = self._photo(attached_to=("Asset Master", asset))
        answers = self._answers("Hinge broken")
        with self.assertRaisesRegex(frappe.ValidationError, "wasn't found"):
            audits_api.submit_audit(assignment, others, answers=answers)
        with self.assertRaisesRegex(frappe.ValidationError, "wasn't found"):
            audits_api.submit_audit(assignment, attached, answers=answers)
        with self.assertRaisesRegex(frappe.ValidationError, "must be a photo"):
            audits_api.submit_audit(assignment, self._photo(file_name="proof.pdf"), answers=answers)
        self.assertEqual(self._row(assignment).audit_status, "Pending")

    # -- the questions ---------------------------------------------------------------------------

    def test_the_answers_are_saved_on_the_assignment_and_on_the_history_row(self):
        asset, assignment = self._assign("it")
        self._submit(assignment, answers=self._answers("  Battery drains in an hour  "))
        expected = [
            {"id": "working", "q": "Is it working?", "a": "No, it is not working", "flag": 1,
             "text": "Battery drains in an hour"},
        ]
        self.assertEqual(frappe.parse_json(self._row(assignment).audit_answers), {"answers": expected})
        fulfilled = self._history(asset, "Audit Fulfilled")
        self.assertEqual(frappe.parse_json(fulfilled[0].audit_answers), {"answers": expected})
        self.assertEqual(self._history(asset, "Audit Requested")[0].audit_answers, None)  # only on Fulfilled rows
        frappe.set_user(self.pmo)  # the Fulfilled list reads them through the history API
        rows = get_asset_history(event="Audit Fulfilled", asset=asset)["rows"]
        self.assertEqual(frappe.parse_json(rows[0].audit_answers), {"answers": expected})

    def test_missing_or_broken_answers_change_nothing(self):
        asset, assignment = self._assign()
        photo = self._photo()
        good = json.loads(self._answers("Cracked"))
        cases = [
            (None, "Answer the questions"),
            ("[]", "Answer the questions"),
            ("not json", "Answer the questions"),
            (json.dumps([{"id": QUESTION_ID, "q": QUESTION, "a": ""}]), "missing"),
            (json.dumps(good + [good[0]]), "answered twice"),
            (json.dumps([_answer("")]), "Describe the problem"),
        ]
        frappe.set_user(self.holder)
        for answers, message in cases:
            with self.assertRaisesRegex(frappe.ValidationError, message):
                audits_api.submit_audit(assignment, photo, None, answers)
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_answers), ("Pending", None))
        self.assertFalse(frappe.db.get_value("File", {"file_url": photo}, "attached_to_name"))  # photo not claimed
        self.assertEqual(self._history(asset, "Audit Fulfilled"), [])

    def test_the_assignment_and_the_asset_still_save_after_an_audit_with_answers(self):
        """A JSON column comes back as Python; the next save of either document must accept it."""
        asset, assignment = self._assign()
        self._submit(assignment, photo=self._photo(), answers=self._answers("Dent"))
        frappe.set_user("Administrator")
        frappe.get_doc("Asset Management", assignment).save(ignore_permissions=True)
        doc = frappe.get_doc("Asset Master", asset)
        doc.asset_description = "edited after an audit"
        doc.save(ignore_permissions=True)

    def test_the_next_audit_replaces_the_latest_answers_and_the_history_keeps_both(self):
        asset, assignment = self._assign()
        photo = self._photo()
        self._submit(assignment, photo=photo, answers=self._answers("Display flickers"))
        frappe.set_user("Administrator")
        with self._scoped():
            self.assertEqual(open_next_month_audits(day=self.the_28th)["opened"], [assignment])
        self._submit(assignment)  # next month's: working, no image
        row = self._row(assignment)
        self.assertEqual(frappe.parse_json(row.audit_answers)["answers"], [_answer()])
        self.assertEqual(row.audit_proof, None)  # the latest audit's image: none this month
        history = self._history(asset, "Audit Fulfilled")
        months = [frappe.parse_json(r.audit_answers)["answers"][0] for r in history]
        self.assertEqual([m["a"] for m in months], [NO, YES])
        self.assertEqual(months[0]["text"], "Display flickers")
        self.assertEqual([r.declaration for r in history], [photo, None])  # last month's image stays on its row

    # -- a direct save of the assignment (REST / Desk), not the dialog -------------------------------

    def _save_audit(self, assignment, **fields):
        """Save the assignment the way `PUT /api/resource/Asset Management/<name>` does, with these fields."""
        frappe.set_user("Administrator")
        doc = frappe.get_doc("Asset Management", assignment)
        doc.update(fields)
        doc.save(ignore_permissions=True)

    def test_a_direct_save_cant_mark_an_audit_fulfilled_without_answers_or_with_a_bad_image(self):
        asset, assignment = self._assign()
        photo = self._photo()
        good = {"answers": [_answer()]}
        cases = [
            ({}, "answers"),  # the status alone
            ({"audit_proof": photo}, "answers"),
            ({"audit_answers": {"answers": []}}, "answers"),
            ({"audit_answers": json.dumps(good["answers"])}, "answers"),  # a bare list
            ({"audit_answers": {"answers": good["answers"] + good["answers"]}}, "answers"),
            ({"audit_answers": {"answers": [_answer("")]}}, "answers.*Describe the problem under"),  # the reason, too
            ({"audit_proof": "/files/not-uploaded.jpg", "audit_answers": good}, "photo"),  # no such file
            ({"audit_proof": self._photo(file_name="proof.pdf"), "audit_answers": good}, "photo"),  # not a photo
        ]
        for fields, message in cases:
            with self.assertRaisesRegex(frappe.ValidationError, message, msg=fields):
                self._save_audit(assignment, audit_status="Fulfilled", **fields)
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_proof, row.audit_answers), ("Pending", None, None))
        self.assertEqual(self._history(asset, "Audit Fulfilled"), [])

    def test_a_direct_save_with_answers_is_allowed_with_or_without_an_image(self):
        _, assignment = self._assign()
        self._save_audit(assignment, audit_status="Fulfilled", audit_answers={"answers": [_answer()]})
        self.assertEqual((self._row(assignment).audit_status, self._row(assignment).audit_proof), ("Fulfilled", None))

        _, other = self._assign("it")
        photo = self._photo()
        self._save_audit(other, audit_status="Fulfilled", audit_proof=photo, audit_answers={"answers": [_answer("Bent leg")]})
        self.assertEqual(self._row(other).audit_status, "Fulfilled")

    def test_an_audit_sent_before_the_questions_still_saves_until_its_audit_fields_change(self):
        """Older Fulfilled rows have a photo but no answers: a declaration saves them as before."""
        _, assignment = self._assign()
        photo = self._photo()
        frappe.db.set_value("Asset Management", assignment, {"audit_status": "Fulfilled", "audit_proof": photo})
        self._save_audit(assignment)  # nothing about the audit changes
        with self.assertRaisesRegex(frappe.ValidationError, "answers"):
            self._save_audit(assignment, audit_proof="")
        self.assertEqual(self._row(assignment).audit_proof, photo)

    def test_an_older_red_answer_without_a_note_still_saves_until_its_audit_fields_change(self):
        """Before 2026-10-21 a red answer's note was optional; such an audit must not block a declaration."""
        _, assignment = self._assign()
        old = {"answers": [{"id": "damage", "q": "Is it damaged anywhere?", "a": "Small damage: scratches or dents", "flag": 1}]}
        frappe.db.set_value(
            "Asset Management", assignment,
            {"audit_status": "Fulfilled", "audit_proof": self._photo(), "audit_answers": json.dumps(old)},
        )
        self._save_audit(assignment)  # nothing about the audit changes
        self.assertEqual(self._row(assignment).audit_status, "Fulfilled")

    # -- unassign -------------------------------------------------------------------------------

    def test_admin_unassign_is_never_blocked_and_keeps_the_photo(self):
        asset, assignment = self._assign()
        photo = self._photo()
        self._submit(assignment, photo=photo)
        frappe.set_user("Administrator")
        # a new month's audit is open again -- unassign still goes through
        frappe.db.set_value("Asset Management", assignment, {"audit_status": "Pending"})
        unassign_asset(asset, "Employee left / exit")
        self.assertFalse(frappe.db.exists("Asset Management", assignment))
        file = frappe.db.get_value("File", {"file_url": photo}, ["attached_to_doctype", "attached_to_name"], as_dict=True)
        self.assertEqual((file.attached_to_doctype, file.attached_to_name), ("Asset Master", asset))
        self.assertEqual(self._history(asset, "Audit Fulfilled")[0].declaration, photo)

    # -- the category switch --------------------------------------------------------------------

    def test_ticking_a_category_opens_its_audits_at_once(self):
        first_asset, first = self._assign("chair")
        _, second = self._assign("chair", person=self.holder2)
        _, unsigned = self._assign("chair", person=self.stranger, declaration=False)
        frappe.set_user(self.admin)
        result = audits_api.set_category_audit(self.categories["chair"], 1)
        self.assertEqual(result["opened"], 2)
        self.assertEqual([self._row(r).audit_status for r in (first, second)], ["Pending", "Pending"])
        self.assertFalse(self._row(unsigned).audit_status)
        self.assertEqual(
            self._history(first_asset, "Audit Requested")[-1].reason, f"{self.month} · category audit switched on"
        )
        self.assertEqual(audits_api.set_category_audit(self.categories["chair"], 1)["opened"], 0)

    def test_unticking_keeps_open_audits_and_stops_new_ones(self):
        _, assignment = self._assign("it")
        frappe.set_user(self.admin)
        audits_api.set_category_audit(self.categories["it"], 0)
        self.assertEqual(self._row(assignment).audit_status, "Pending")
        frappe.db.set_value("Asset Management", assignment, "audit_status", "Fulfilled")
        self.assertEqual(open_due_audits(day=self.next_month_day, assignment=assignment), [])

    def test_only_admin_switches_a_category(self):
        """Owner, 2026-10-14: the Monthly Audit column is Admin's alone -- HR and PMO too are refused."""
        for user in (self.holder, self.procurement, self.hr_lead, self.hr, self.pmo):
            frappe.set_user(user)
            with self.assertRaises(frappe.PermissionError, msg=user):
                audits_api.set_category_audit(self.categories["chair"], 1)
        # Desk / REST: HR Lead's Role may write Asset Category, the audit switch is still refused -- on a
        # change, and on a new category created with it on
        frappe.set_user(self.hr_lead)
        doc = frappe.get_doc("Asset Category", self.categories["chair"])
        doc.audit_required = 1
        with self.assertRaises(frappe.PermissionError):
            doc.save()
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc({
                "doctype": "Asset Category", "asset_category": f"{CATEGORY_PREFIX} Audit new {frappe.generate_hash(length=6)}",
                "category_type": "IT", "audit_required": 1,
            }).insert()
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value("Asset Category", self.categories["chair"], "audit_required"), 0)
        for user in (self.admin, "Administrator"):
            frappe.set_user(user)
            on = audits_api.set_category_audit(self.categories["chair"], 1)["audit_required"]
            self.assertEqual(on, 1, user)
            audits_api.set_category_audit(self.categories["chair"], 0)

    def test_a_second_simultaneous_switch_gets_a_plain_message(self):
        """Two admins switching a category at once: the second lock fails on PostgreSQL (#6, owner 2026-10-15)."""

        class SerializationFailure(Exception):
            pgcode = "40001"

        real = frappe.get_doc

        def lock_fails(*args, **kwargs):
            if kwargs.get("for_update"):
                raise SerializationFailure()
            return real(*args, **kwargs)

        frappe.set_user(self.admin)
        with patch.object(frappe, "get_doc", side_effect=lock_fails):
            with self.assertRaisesRegex(frappe.ValidationError, "just changed by someone else"):
                audits_api.set_category_audit(self.categories["chair"], 1)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.get_value("Asset Category", self.categories["chair"], "audit_required"), 0)

    # -- the runs ---------------------------------------------------------------------------------

    def test_the_28th_run_opens_what_is_due_even_with_a_leftover_returned_flag(self):
        _, due = self._assign("chair")
        _, flagged = self._assign("chair", person=self.holder2)
        frappe.db.set_value("Asset Category", self.categories["chair"], "audit_required", 1)  # no hook: nothing opened
        frappe.db.set_value("Asset Management", flagged, "returned", 1)  # returns were removed: the flag means nothing
        with self._scoped():
            open_next_month_audits(day=self.the_28th)
            self.assertEqual((self._row(due).audit_status, self._row(due).audit_month), ("Pending", self.next_month))
            self.assertEqual(self._row(flagged).audit_status, "Pending")
            open_next_month_audits(day=self.the_28th)  # a second run opens nothing more
            self.assertEqual(len(self._history(self._row_asset(due), "Audit Requested")), 1)

    def test_after_a_missed_month_the_audit_sent_is_this_months(self):
        """Last month's audit unsent: the 7th records it Missed and moves it here; sending it is this month's and
        clears the overdue month, nothing more opens this month, the next month's opens on the next 28th."""
        asset, assignment = self._assign()
        last_month = audit_month_label(add_months(self.cycle, -1))
        frappe.db.set_value("Asset Management", assignment, "audit_month", last_month)  # opened last month, unsent
        with self._scoped():
            self.assertEqual(close_last_month_audits(day=self.the_7th)["missed"], [assignment])
        row = self._row(assignment)
        self.assertEqual((row.audit_status, row.audit_month, row.audit_overdue_since), ("Pending", self.month, last_month))
        self._submit(assignment)
        frappe.set_user("Administrator")
        self.assertEqual(self._history(asset, "Audit Fulfilled")[-1].reason, f"for {self.month}")
        self.assertIsNone(self._row(assignment).audit_overdue_since)
        with self._scoped():
            self.assertEqual(close_last_month_audits(day=self.the_7th), {"missed": [], "moved": [], "closed": [], "opened": []})
            self.assertEqual(open_next_month_audits(day=self.the_28th), {"opened": [assignment]})

    def test_the_runs_are_scheduled_on_the_28th_and_the_7th(self):
        """Owner, 2026-10-14: the run on the 1st is gone; so is the Start button (Frappe catches up a missed run)."""
        cron = frappe.get_hooks("scheduler_events")["cron"]
        self.assertIn("nirmaan_stack.tasks.asset_audit.open_next_month_audits", cron["0 6 28 * *"])
        self.assertIn("nirmaan_stack.tasks.asset_audit.close_last_month_audits", cron["0 6 7 * *"])
        self.assertFalse(hasattr(audit_tasks, "start_monthly_audits"))
        self.assertFalse(hasattr(audits_api, "start_audits_now"))

    # -- who reads the audit rows ---------------------------------------------------------------

    def test_pmo_and_procurement_read_audit_rows_only(self):
        asset, assignment = self._assign()
        self._submit(assignment)
        for user in (self.pmo, self.procurement):
            frappe.set_user(user)
            rows = get_asset_history(event="Audit Fulfilled", asset=asset)["rows"]
            self.assertEqual([r.event for r in rows], ["Audit Fulfilled"], user)
            for event in (None, "Assigned"):
                with self.assertRaises(frappe.PermissionError, msg=f"{user} {event}"):
                    get_asset_history(event=event, asset=asset)
        frappe.set_user(self.holder)
        with self.assertRaises(frappe.PermissionError):
            get_asset_history(event="Audit Fulfilled", asset=asset)

    def test_the_history_filters_by_project_or_it(self):
        project_asset, project_row = self._assign("project")
        it_asset, it_row = self._assign("it", person=self.holder2)
        self._submit(project_row)
        self._submit(it_row, user=self.holder2)
        frappe.set_user(self.pmo)
        it_rows = get_asset_history(event="Audit Fulfilled", category_type="IT", asset="Audit test")["rows"]
        assets = {r.asset for r in it_rows}
        self.assertIn(it_asset, assets)
        self.assertNotIn(project_asset, assets)
