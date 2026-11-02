# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Cashbook upload accepts only the Cashbook Statement, with live bill links (#1590).

ADR-0015 Amendment B decisions 1 and 2, at the upload endpoint seam: the older export (no
`Attachments` column) and a statement whose links expired, or expire within the hour, are refused
by preview and by confirm, and a refused confirm saves nothing. An accepted statement's bill links
are stored on each staged line.

Endpoints are driven as `test_cashbook_import.TestRepeatsAreNotSaved` drives them: only the transport
is faked. The upload's clock is `cb._utc_now`, set here, because the fixture's links (signed
2026-10-30/31 for 7 days; earliest expiry 2026-11-06 09:00 UTC) expire in real time.
"""

from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import.test_cashbook_import import FIXTURE, _purge
from nirmaan_stack.services.outflow_import.parser import parse_statement

FIXTURES = FIXTURE.parent
STATEMENT = FIXTURES / "cashbook_statement.xlsx"
OLD_EXPORT = FIXTURES / "cashbook_old_export.csv"
EARLIEST_EXPIRY = datetime(2026, 11, 6, 9, 0, tzinfo=timezone.utc)
OLD_EXPORT_SENTENCE = (
    "This is the old export without bill links. Export the Consolidated Company Account Statement."
)


def _post(endpoint, content: bytes, filename: str):
    import io

    from werkzeug.datastructures import FileStorage, MultiDict

    class _Request:
        files = MultiDict({"file": FileStorage(stream=io.BytesIO(content), filename=filename)})

    previous = getattr(frappe.local, "request", None)
    frappe.set_user("Administrator")
    frappe.local.request = _Request()
    try:
        return endpoint()
    finally:
        frappe.local.request = previous


def _saved_counts():
    return tuple(
        frappe.db.count(doctype) for doctype in ("File", "Outflow Import Batch", "Outflow Import Row")
    )


class TestRefusedUploads(FrappeTestCase):
    def _refused(self, endpoint, path: Path, now: datetime | None = None) -> str:
        before = _saved_counts()
        clock = patch.object(cb, "_utc_now", return_value=now) if now else nullcontext()
        with clock, self.assertRaises(frappe.ValidationError) as caught:
            _post(endpoint, path.read_bytes(), path.name)
        self.assertEqual(_saved_counts(), before)
        return str(caught.exception)

    def test_the_old_export_is_refused_on_preview(self):
        self.assertEqual(self._refused(cb.preview_cashbook_statement, OLD_EXPORT), OLD_EXPORT_SENTENCE)

    def test_the_old_export_is_refused_on_confirm_and_nothing_is_saved(self):
        self.assertEqual(self._refused(cb.confirm_cashbook_import, OLD_EXPORT), OLD_EXPORT_SENTENCE)

    def test_a_statement_whose_links_expired_is_refused_naming_the_date(self):
        message = self._refused(
            cb.confirm_cashbook_import, STATEMENT, now=EARLIEST_EXPIRY + timedelta(days=2)
        )
        self.assertEqual(message, "Links expired on 06-Nov-2026 14:30. Export the statement again.")

    def test_a_statement_whose_links_expire_within_the_hour_is_refused(self):
        message = self._refused(
            cb.confirm_cashbook_import, STATEMENT, now=EARLIEST_EXPIRY - timedelta(minutes=30)
        )
        self.assertEqual(message, "Links expired on 06-Nov-2026 14:30. Export the statement again.")

    def test_the_preview_refuses_expired_links_too(self):
        message = self._refused(
            cb.preview_cashbook_statement, STATEMENT, now=EARLIEST_EXPIRY + timedelta(days=2)
        )
        self.assertIn("Export the statement again.", message)


class TestAcceptedStatement(FrappeTestCase):
    def test_a_statement_with_live_links_is_previewed(self):
        with patch.object(cb, "_utc_now", return_value=EARLIEST_EXPIRY - timedelta(days=3)):
            payload = _post(cb.preview_cashbook_statement, STATEMENT.read_bytes(), STATEMENT.name)
        self.assertIn("refused", payload)

    def _stage_sample(self) -> str:
        parsed = parse_statement(FIXTURE.read_bytes(), source="Cashbook")
        batch = cb._stage(
            parsed,
            cb._build_plan(parsed),
            file_url="/private/files/test-statement.csv",
            filename="test-statement.csv",
            user="Administrator",
        ).name
        frappe.db.commit()
        self.addCleanup(_purge, batch)
        return batch

    def _links(self, batch) -> dict:
        return {
            row.transfer_id: (frappe.parse_json(row.bill_links) or {}).get("links", [])
            for row in frappe.get_all(
                "Outflow Import Row",
                filters={"import_batch": batch},
                fields=["transfer_id", "bill_links"],
            )
        }

    def test_each_staged_line_keeps_its_bill_links_in_order(self):
        stored = self._links(self._stage_sample())
        self.assertEqual(
            [link.split("?")[0].rsplit("/", 1)[1] for link in stored["OBO1700000000004DDDDDD"]],
            ["1.jpeg", "2.pdf"],
        )
        self.assertEqual(len(stored["OBO1700000000001AAAAAA"]), 1)
        self.assertEqual(stored["OBO1700000000002BBBBBB"], [])

    def test_a_staged_line_with_links_can_still_be_saved_again(self):
        """A later save of the line (Skip by hand, a decision) reads the stored links back and
        writes them again; they must survive the round trip."""
        batch = self._stage_sample()
        name = frappe.db.get_value(
            "Outflow Import Row", {"import_batch": batch, "transfer_id": "OBO1700000000004DDDDDD"}
        )
        doc = frappe.get_doc("Outflow Import Row", name)
        doc.outcome_note = "saved again"
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        self.assertEqual(len(self._links(batch)["OBO1700000000004DDDDDD"]), 2)
