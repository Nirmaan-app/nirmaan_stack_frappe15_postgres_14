# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""No doctype field whose name says it holds a file or a URL is a Data field (#1678).

Pure: no bench, no site, no DB. It reads the doctype JSON under `nirmaan_stack/nirmaan_stack/doctype/` from disk.

THE BUG THIS EXISTS TO PREVENT
    A Data field holds 140 characters. A stored cloud file URL runs 141 to 299 (2026-10-28 data). Spec #1637 made
    `Expense Bill.bill_file` Data; every test passed on short fake URLs and real bill saves would have failed.
    Tests now build URLs with `cloud_file_fixture.cloud_url`; this test catches the field type itself.

WHAT IT FLAGS
    A field of type Data whose name ends in `_file`, `_url` or `_link`, or contains `attachment`. Use Attach,
    Small Text or Long Text instead. A name that matches but holds no URL, or a real exception, goes in `ALLOWED`
    with its reason.

Run:  devenv.sh unit nirmaan_stack.test_url_fields
"""

import json
import re
import unittest
from pathlib import Path

DOCTYPES = Path(__file__).parent / "nirmaan_stack" / "doctype"
URL_NAME = re.compile(r"(_file$|_url$|_link$|attachment)")

# (doctype, fieldname): why it may stay Data. Max lengths are from the 2026-10-28 data.
ALLOWED = {
    # The name matches, but the field holds no URL.
    ("Cashflow Plan", "id_link"): "the name of a PO or Work Order the plan links to, not a URL",
    ("Nirmaan Attachments", "attachment_type"): "a label for the attachment's kind (longest 28)",
    ("Nirmaan Attachments", "attachment_ref"): "free-text reference for an attachment (longest 78)",
    ("Project Progress Reports", "attachment_remarks"): "free-text remarks, empty in all 3,673 rows",
    ("Quotation Requests", "attachment"): "legacy, empty in all 7,233 rows; the RFQ's files are Nirmaan Attachments",
    # Internal app paths the code builds itself, not uploaded files.
    ("Nirmaan Notifications", "action_url"): "an SPA route the code builds (longest 68)",
    ("Project Action Item", "action_url"): "an SPA route the code builds (longest 58)",
    # ⚠️ Pasted outside URLs (Google Drive, Loom) in a 140-character field. Each is a candidate ticket, not
    # allowed for good: Design Tracker and Drive Link values already stop at 138 with a trailing `&`.
    ("Commission Report Task Child Table", "file_link"): "candidate bug: a pasted Drive link (empty today)",
    ("Customer PO Child Table", "customer_po_link"): "candidate bug: a pasted Drive link (longest 135)",
    ("Design Tracker Task Child Table", "file_link"): "candidate bug: a pasted Drive link (longest 138, cut)",
    ("Project Drive Link Child Table", "drive_link"): "candidate bug: a pasted Drive link (longest 138, cut)",
    ("Help Repository", "video_link"): "candidate bug: a pasted Loom link (longest 59)",
    ("Project Billing", "bill_document_link"): "candidate bug: a pasted document URL (options URL; no rows today)",
}


def _url_named_data_fields():
    for path in sorted(DOCTYPES.glob("*/*.json")):
        meta = json.loads(path.read_text())
        if not isinstance(meta, dict) or meta.get("doctype") != "DocType":
            continue
        for field in meta.get("fields", []):
            if field.get("fieldtype") == "Data" and URL_NAME.search(field.get("fieldname", "")):
                yield meta["name"], field["fieldname"]


class TestUrlFields(unittest.TestCase):
    def test_a_file_or_url_field_is_not_data(self):
        found = set(_url_named_data_fields())
        self.assertEqual(sorted(found - ALLOWED.keys()), [], "Data field named for a file or URL: use Small Text")

    def test_every_allowed_field_still_exists_as_data(self):
        found = set(_url_named_data_fields())
        self.assertEqual(sorted(ALLOWED.keys() - found), [], "stale ALLOWED entry: remove it")

    def test_it_catches_each_name_shape(self):
        for name in ("bill_file", "file_url", "drive_link", "invoice_attachment", "attachment"):
            with self.subTest(name=name):
                self.assertTrue(URL_NAME.search(name))
        for name in ("file_name", "linked_to", "url_count"):
            with self.subTest(name=name):
                self.assertFalse(URL_NAME.search(name))


if __name__ == "__main__":
    unittest.main()
