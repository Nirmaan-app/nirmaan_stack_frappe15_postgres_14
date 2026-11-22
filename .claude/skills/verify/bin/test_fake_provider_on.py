"""The match flow's FakeProviderOn (#1654, #1718) never leaves the real AI key where the app reads it. Needs the env DB:

    devenv.sh script <task> .claude/skills/verify/bin/test_fake_provider_on.py

It stores a made-up key in place of the env's for each test and puts back exactly what the env held (the key rows and
the AI settings) when the test ends. No model is called.
"""

import importlib.util
import os
import tempfile
import unittest
from unittest import mock

import frappe

from nirmaan_stack.api.boq.wizard.ai_settings import SETTINGS_DOCTYPE, get_boq_ai_api_key
from nirmaan_stack.services.boq_rate_match import pool as match_pool

BIN = f"{os.environ['FRAPPE_BENCH_ROOT']}/apps/nirmaan_stack/.claude/skills/verify/bin"
_spec = importlib.util.spec_from_file_location("background_operations_flows", f"{BIN}/background_operations_flows.py")
flows = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(flows)

MADE_UP_KEY = "sk-made-up-nworker-0001"
SETTINGS = ("enabled", "match_enabled", "match_site_calls_at_once")


def key_rows():
    return frappe.db.sql(
        "select fieldname, password, encrypted from `__Auth` where doctype = %s and name = %s",
        (SETTINGS_DOCTYPE, SETTINGS_DOCTYPE),
    )


def settings():
    return {f: frappe.db.get_single_value(SETTINGS_DOCTYPE, f) for f in SETTINGS}


class FakeProviderOnKey(unittest.TestCase):
    def setUp(self):
        frappe.db.rollback()
        rows, before = key_rows(), settings()
        self.addCleanup(self.put_back, rows, before)
        frappe.db.delete("__Auth", {"doctype": SETTINGS_DOCTYPE, "name": SETTINGS_DOCTYPE})
        frappe.utils.password.set_encrypted_password(SETTINGS_DOCTYPE, SETTINGS_DOCTYPE, MADE_UP_KEY,
                                                     "anthropic_api_key")
        for f in ("enabled", "match_enabled"):
            frappe.db.set_single_value(SETTINGS_DOCTYPE, f, 0)
        frappe.db.commit()
        pool = tempfile.NamedTemporaryFile(suffix=".pkl", delete=False)
        self.addCleanup(lambda: os.path.exists(pool.name) and os.remove(pool.name))
        patcher = mock.patch.object(match_pool, "pool_path", return_value=pool.name)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def put_back(rows, before):
        frappe.db.rollback()
        frappe.db.delete("__Auth", {"doctype": SETTINGS_DOCTYPE, "name": SETTINGS_DOCTYPE})
        for fieldname, password, encrypted in rows:
            frappe.db.sql(
                "insert into `__Auth` (doctype, name, fieldname, password, encrypted) values (%s, %s, %s, %s, %s)",
                (SETTINGS_DOCTYPE, SETTINGS_DOCTYPE, fieldname, password, encrypted),
            )
        for f, value in before.items():
            frappe.db.set_single_value(SETTINGS_DOCTYPE, f, value)
        frappe.db.commit()

    def test_while_it_holds_the_app_reads_the_dummy_key_and_after_it_the_key_it_found(self):
        with flows.FakeProviderOn(2):
            self.assertEqual(get_boq_ai_api_key(), flows.DUMMY_KEY)
            self.assertEqual(settings(), {"enabled": 1, "match_enabled": 1, "match_site_calls_at_once": 2})
        self.assertEqual(get_boq_ai_api_key(), MADE_UP_KEY)
        self.assertEqual((settings()["enabled"], settings()["match_enabled"]), (0, 0))

    def test_a_run_killed_while_it_held_leaves_the_dummy_key_and_the_next_run_puts_the_real_one_back(self):
        flows.FakeProviderOn(2).__enter__()  # killed: __exit__ never runs
        frappe.db.rollback()
        self.assertEqual(get_boq_ai_api_key(), flows.DUMMY_KEY)
        with flows.FakeProviderOn(2):
            self.assertEqual(get_boq_ai_api_key(), flows.DUMMY_KEY)
        self.assertEqual(get_boq_ai_api_key(), MADE_UP_KEY)

    def test_a_failure_part_way_into_it_undoes_every_change(self):
        os.remove(match_pool.pool_path())
        with mock.patch.object(match_pool, "rebuild_pool", side_effect=RuntimeError("pool build failed")):
            with self.assertRaisesRegex(RuntimeError, "pool build failed"):
                with flows.FakeProviderOn(2):
                    self.fail("the flow ran though its settings failed")
        frappe.db.rollback()
        self.assertEqual(get_boq_ai_api_key(), MADE_UP_KEY)
        self.assertEqual((settings()["enabled"], settings()["match_enabled"]), (0, 0))


if __name__ == "__main__":
    outcome = unittest.main(argv=["test_fake_provider_on"], exit=False).result
    raise SystemExit(0 if outcome.wasSuccessful() else 1)
