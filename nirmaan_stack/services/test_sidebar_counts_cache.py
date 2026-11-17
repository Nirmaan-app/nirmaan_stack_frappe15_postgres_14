# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The sidebar badge counts kept in Redis (services/sidebar_counts_cache).

Run: bench --site localhost run-tests --module nirmaan_stack.services.test_sidebar_counts_cache

The parts are replaced by fakes that count their calls, and every key is written under a prefix made for the
run, so no real kept count is read or changed; the prefix's keys are deleted afterwards. The real counting and
the real save path are covered by api/test_sidebar_counts (a planted Work Order moves the count at once).
"""

from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from redis.exceptions import ConnectionError as RedisConnectionError

from nirmaan_stack.api.sidebar_count_parts import PART_DOCTYPES, CountScope
from nirmaan_stack.services import sidebar_counts_cache as scc

HOOK = "nirmaan_stack.services.sidebar_counts_cache.bump_on_change"
TODAY = "2026-11-16"
FULL = CountScope(full_access=True, projects=())


class _FakeParts:
    """A stand-in for every part: returns {"n": calls so far, "scope": ...} and counts calls per part."""

    def __init__(self):
        self.calls = {part: 0 for part in PART_DOCTYPES}

    def parts(self):
        def make(part):
            def count(scope, today):
                self.calls[part] += 1
                return {"n": self.calls[part], "scope": list(scope.projects), "today": today}
            return count
        return {part: make(part) for part in PART_DOCTYPES}


class TestSidebarCountsCache(FrappeTestCase):
    def setUp(self):
        super().setUp()
        prefix = f"test-scc-{frappe.generate_hash(length=8)}"
        self.addCleanup(lambda: frappe.cache().delete_keys(prefix))
        prefix_patch = patch.object(scc, "KEY_PREFIX", prefix)
        prefix_patch.start()
        self.addCleanup(prefix_patch.stop)
        self.fake = _FakeParts()
        parts_patch = patch.object(scc, "PARTS", self.fake.parts())
        parts_patch.start()
        self.addCleanup(parts_patch.stop)

    def _versions(self) -> dict:
        """The current versions; Redis must answer for these tests."""
        versions = scc._read_versions()
        self.assertIsNotNone(versions, "Redis did not answer")
        return versions

    def _counted(self):
        """Parts counted since the last call, then reset."""
        counted = {p for p, n in self.fake.calls.items() if n}
        self.fake.calls = {p: 0 for p in self.fake.calls}
        return counted

    def test_a_second_request_counts_nothing(self):
        first = scc.counts_for(FULL, TODAY)
        self.assertEqual(self._counted(), set(PART_DOCTYPES))
        second = scc.counts_for(FULL, TODAY)
        self.assertEqual(self._counted(), set())
        self.assertEqual(first, second)

    def test_reply_keeps_the_part_order(self):
        self.assertEqual(list(scc.counts_for(FULL, TODAY)), list(PART_DOCTYPES))

    def test_a_change_counts_again_only_the_parts_that_read_it(self):
        scc.counts_for(FULL, TODAY)
        self._counted()
        expected = {
            "Procurement Requests": {"pr"},
            "Sent Back Category": {"sb"},
            "Procurement Orders": {"po", "credits"},
            "Project Payments": {"pay", "credits"},
            "Cheques": {"pay"},
            "Service Requests": {"sr"},
            "PO Revisions": {"po_revisions"},
            "PO Adjustments": {"po_adjustments"},
        }
        for doctype, parts in expected.items():
            with self.subTest(doctype=doctype):
                scc.bump_version(doctype)
                scc.counts_for(FULL, TODAY)
                self.assertEqual(self._counted(), parts)

    def test_two_project_scopes_never_share_numbers(self):
        a = CountScope(full_access=False, projects=("TEST-SCC-PROJ-A",))
        b = CountScope(full_access=False, projects=("TEST-SCC-PROJ-B",))
        got_a = scc.counts_for(a, TODAY)
        got_b = scc.counts_for(b, TODAY)
        self.assertEqual(got_a["pr"]["scope"], ["TEST-SCC-PROJ-A"])
        self.assertEqual(got_b["pr"]["scope"], ["TEST-SCC-PROJ-B"])
        # each read back as its own
        self.assertEqual(scc.counts_for(a, TODAY)["pr"]["scope"], ["TEST-SCC-PROJ-A"])
        self.assertEqual(scc.counts_for(b, TODAY)["pr"]["scope"], ["TEST-SCC-PROJ-B"])

    def test_full_access_and_no_projects_and_some_projects_are_three_scopes(self):
        none = CountScope(full_access=False, projects=())
        some = CountScope(full_access=False, projects=("TEST-SCC-PROJ-A",))
        self.assertEqual(len({scc.scope_key(FULL), scc.scope_key(none), scc.scope_key(some)}), 3)

    def test_the_same_projects_in_another_order_share(self):
        scc.counts_for(CountScope(full_access=False, projects=("TEST-SCC-X", "TEST-SCC-Y")), TODAY)
        self._counted()
        scc.counts_for(CountScope(full_access=False, projects=("TEST-SCC-Y", "TEST-SCC-X")), TODAY)
        self.assertEqual(self._counted(), set())

    def test_one_more_project_is_a_new_scope(self):
        scc.counts_for(CountScope(full_access=False, projects=("TEST-SCC-X",)), TODAY)
        self._counted()
        scc.counts_for(CountScope(full_access=False, projects=("TEST-SCC-X", "TEST-SCC-Y")), TODAY)
        self.assertEqual(self._counted(), set(PART_DOCTYPES))

    def test_a_new_day_counts_again_only_credits(self):
        scc.counts_for(FULL, TODAY)
        self._counted()
        scc.counts_for(FULL, "2026-11-17")
        self.assertEqual(self._counted(), {"credits"})

    def test_a_kept_part_expires(self):
        versions = self._versions()
        scc.counts_for(FULL, TODAY)
        cache = frappe.cache()
        ttl = cache.ttl(cache.make_key(scc.part_key("pr", FULL, TODAY, versions)))
        self.assertTrue(0 < ttl <= scc.KEEP_SECONDS, ttl)

    def test_without_redis_every_part_is_counted_fresh(self):
        with patch.object(frappe.cache(), "mget", side_effect=RedisConnectionError("down")):
            scc.counts_for(FULL, TODAY)
            self.assertEqual(self._counted(), set(PART_DOCTYPES))
            scc.counts_for(FULL, TODAY)
            self.assertEqual(self._counted(), set(PART_DOCTYPES))

    def test_a_change_moves_the_version_only_after_the_commit(self):
        before = self._versions()["Service Requests"]
        scc.bump_on_change(SimpleNamespace(doctype="Service Requests"))
        self.assertEqual(self._versions()["Service Requests"], before)
        frappe.db.commit()
        self.assertEqual(self._versions()["Service Requests"], before + 1)

    def test_a_rolled_back_change_moves_nothing(self):
        before = self._versions()["Service Requests"]
        scc.bump_on_change(SimpleNamespace(doctype="Service Requests"))
        frappe.db.rollback()
        frappe.db.commit()
        self.assertEqual(self._versions()["Service Requests"], before)

    def test_an_uncounted_record_type_moves_nothing(self):
        before = self._versions()
        scc.bump_on_change(SimpleNamespace(doctype="ToDo"))
        frappe.db.commit()
        self.assertEqual(self._versions(), before)

    def test_frappes_own_events_move_the_version(self):
        # An unsaved document runs the events a save or db_set (on_change) and a delete (after_delete) run, through
        # Frappe's doc_events dispatch; nothing is written to the database.
        doc = frappe.new_doc("Service Requests")
        for event in ("on_change", "after_delete"):
            with self.subTest(event=event):
                before = self._versions()["Service Requests"]
                doc.run_method(event)
                frappe.db.commit()
                self.assertEqual(self._versions()["Service Requests"], before + 1)

    def test_every_save_db_set_and_delete_is_hooked(self):
        events = frappe.get_hooks("doc_events").get("*", {})
        for event in ("on_change", "after_delete"):
            with self.subTest(event=event):
                self.assertIn(HOOK, events.get(event, []))
