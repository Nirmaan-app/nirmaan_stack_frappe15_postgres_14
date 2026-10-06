# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Schema tests for the CEO Hold Reason doctype.

CEO Hold Reason is a STANDALONE projection (istable=0) of automatic CEO-Hold conditions,
one row per (project, source), enforced by the UNIQUE index on `dedup_key`. The controller
is a bare stub; the `services/ceo_hold/core.py` engine writes rows via ignore_permissions.
"""

import frappe
from frappe.exceptions import DuplicateEntryError, UniqueValidationError
from frappe.tests.utils import FrappeTestCase

# A dedup clash surfaces as the in-app pre-check error OR the DB unique-index error.
_DUP_ERRORS = (UniqueValidationError, DuplicateEntryError)

_PROJECT = "TESTCHR"  # a fake project name; links bypassed via ignore_links


def _make(source, project=_PROJECT, text="reason"):
    return frappe.get_doc(
        {
            "doctype": "CEO Hold Reason",
            "project": project,
            "source": source,
            "dedup_key": f"{project}::{source}",
            "reason_text": text,
            "set_at": frappe.utils.now_datetime(),
        }
    ).insert(ignore_permissions=True, ignore_links=True)


class TestCEOHoldReason(FrappeTestCase):
    def tearDown(self):
        frappe.db.delete("CEO Hold Reason", {"project": _PROJECT})
        frappe.db.commit()

    def test_autoname_prefix(self):
        doc = _make("dn_pending")
        self.assertTrue(doc.name.startswith("CHR-"))
        self.assertEqual(doc.source, "dn_pending")
        self.assertTrue(doc.set_at)

    def test_dedup_key_is_unique(self):
        _make("dn_pending")
        with self.assertRaises(_DUP_ERRORS):
            _make("dn_pending")  # same (project, source) → same dedup_key → rejected

    def test_two_sources_for_one_project_coexist(self):
        # ⚠️ SLICE 12c-T (item 7): THIS TEST PASSES ALONE AND FAILED INSIDE THE FULL RUN, AND THE
        # CAUSE IS THE TEST BEFORE IT, NOT THE PRODUCT.
        #
        # `test_dedup_key_is_unique` provokes a UNIQUE-index violation. In PostgreSQL that ABORTS the
        # transaction -- every subsequent statement answers "current transaction is aborted, commands
        # ignored until end of transaction block" -- and `FrappeTestCase` has no per-test rollback
        # (its only one is `addClassCleanup(_rollback_db)`, which runs after `tearDownClass`). So the
        # shared `tearDown` delete raised for that test AND this one's first insert raised too, which
        # is why this single test appeared TWICE in the error list: once for itself, once for its
        # teardown.
        #
        # Ending the poisoned transaction is this test's own business, so it is done here rather than
        # in the shared `setUp` -- `test_dedup_key_is_unique` is another team's and stays untouched
        # (T3), assertion and all. The rollback also discards that test's uncommitted row, and the
        # delete below removes any row an earlier teardown failed to clear, so this starts clean
        # whatever ran before it.
        frappe.db.rollback()
        frappe.db.delete("CEO Hold Reason", {"project": _PROJECT})
        frappe.db.commit()
        _make("dn_pending")
        _make("cashflow")
        rows = frappe.get_all(
            "CEO Hold Reason", filters={"project": _PROJECT}, fields=["source"]
        )
        self.assertEqual({r.source for r in rows}, {"dn_pending", "cashflow"})
