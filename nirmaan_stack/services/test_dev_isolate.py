"""CU-B AC1: scripts/dev_isolate.py (loaded by path: it is a script, not a package).

Never touches a real record: every isolate / verify / restore call is scoped to this test's own fixtures, the
stopped list is empty, and the site config is a temporary copy. Fixtures are raw rows (db_insert / __Auth), the
shape the script reads, and are removed in cleanup.
"""
import importlib.util
import json
import os
import shutil
import tempfile

import frappe
from frappe.tests.utils import FrappeTestCase

PREFIX = "TEST_CUB_ISO_"
GOOD_CONF = {"developer_mode": 1, "db_host": "postgresql", "nirmaan_env": "dev"}


def _script():
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "dev_isolate.py"))
    spec = importlib.util.spec_from_file_location("dev_isolate", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


iso = _script()


class TestRefusals(FrappeTestCase):
    """The guards: the script refuses anything but the marked local dev site, and refuses without --yes."""

    def test_the_marked_dev_site_with_yes_passes(self):
        self.assertEqual(iso.refusals("localhost", GOOD_CONF, True), [])

    def test_no_marker_refuses(self):
        why = iso.refusals("localhost", {**GOOD_CONF, "nirmaan_env": None}, True)
        self.assertEqual(len(why), 1)
        self.assertIn("nirmaan_env", why[0])

    def test_a_production_marker_value_refuses(self):
        self.assertTrue(iso.refusals("localhost", {**GOOD_CONF, "nirmaan_env": "prod"}, True))

    def test_another_site_refuses(self):
        why = iso.refusals("erp.nirmaan.app", GOOD_CONF, True)
        self.assertEqual(len(why), 1)
        self.assertIn("site", why[0])

    def test_no_yes_refuses(self):
        self.assertEqual(iso.refusals("localhost", GOOD_CONF, False), ["--yes not given"])

    def test_developer_mode_off_or_a_remote_db_refuses(self):
        self.assertTrue(iso.refusals("localhost", {**GOOD_CONF, "developer_mode": 0}, True))
        self.assertTrue(iso.refusals("localhost", {**GOOD_CONF, "db_host": "10.0.0.5"}, True))


class TestIsolateVerifyRestore(FrappeTestCase):
    """On fixtures only: verify fails on a live state, isolate fixes it, restore puts every value back."""

    def setUp(self):
        frappe.db.rollback()
        h = frappe.generate_hash(length=6)
        self.user = f"{PREFIX.lower()}{h}@example.com"
        self.account = f"{PREFIX}MAIL_{h}"
        self.asset = f"{PREFIX}ASSET_{h}"
        self.auth = [("Asset Master", self.asset, "asset_pin"), ("Asset Master", self.asset, "asset_email_password"),
                     ("User", self.user, "api_secret")]
        self.addCleanup(self._purge)
        frappe.get_doc({"doctype": "Nirmaan Users", "name": self.user, "email": self.user, "full_name": "CU-B iso",
                        "fcm_token": "TEST_CUB_TOKEN_not_real", "push_notification": "true"}).db_insert()
        frappe.get_doc({"doctype": "Email Account", "name": self.account, "email_account_name": self.account,
                        "email_id": f"{h}@example.com", "enable_incoming": 1, "enable_outgoing": 1}).db_insert()
        for doctype, name, field in self.auth:
            frappe.db.sql('insert into "__Auth" (doctype, name, fieldname, password, encrypted) values (%s,%s,%s,%s,1)',
                          (doctype, name, field, f"enc-{field}-{h}"))
        frappe.db.commit()
        self.scope = {"Nirmaan Users": [self.user], "Email Account": [self.account], "Token Cache": [],
                      "Asset Master": [self.asset], "User": [self.user]}
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        self.conf_path = os.path.join(tmp, "site_config.json")
        self.conf_before = {"db_name": "x", "nirmaan_env": "dev", "mute_emails": 1}
        with open(self.conf_path, "w") as fh:
            json.dump(self.conf_before, fh)

    def _purge(self):
        frappe.db.rollback()
        frappe.db.sql('delete from "tabNirmaan Users" where name = %s', (self.user,))
        frappe.db.sql('delete from "tabEmail Account" where name = %s', (self.account,))
        for doctype, name, _f in self.auth:
            frappe.db.sql('delete from "__Auth" where doctype = %s and name = %s', (doctype, name))
        frappe.db.commit()

    def _state(self):
        nu = frappe.db.get_value("Nirmaan Users", self.user, ["fcm_token", "push_notification"])
        ea = frappe.db.get_value("Email Account", self.account, ["enable_incoming", "enable_outgoing"])
        auth = sorted(frappe.db.sql('select doctype, name, fieldname, password from "__Auth" where name in (%s, %s)',
                                    (self.asset, self.user)))
        return nu, ea, auth

    def test_verify_reports_a_live_fixture_as_failing(self):
        _counts, failures = iso.verify([], names=self.scope, config_path=self.conf_path)
        for item in ("push_tokens", "push_on", "email_accounts_enabled", "asset_secrets", "disable_push"):
            self.assertIn(item, failures)

    def test_isolate_then_verify_passes_and_restore_round_trips(self):
        before = self._state()
        backup, changed = iso.isolate([], names=self.scope, config_path=self.conf_path)
        self.assertEqual(changed["nirmaan_users"], 1)
        self.assertEqual(changed["email_accounts"], 1)
        self.assertEqual(changed["asset_secrets"], 2)
        self.assertEqual(changed["api_secrets"], 1)
        iso.isolate_config(backup, self.conf_path)
        counts, failures = iso.verify([], names=self.scope, config_path=self.conf_path)
        self.assertEqual(failures, [], counts)
        nu, ea, auth = self._state()
        self.assertEqual(nu, ("", "false"))
        self.assertEqual(ea, (0, 0))
        secret = lambda rows: [r for r in rows if r[2] == "api_secret"][0][3]  # noqa: E731
        self.assertNotEqual(secret(auth), secret(before[2]), "api_secret rotated")
        restored = iso.restore(backup, config_path=self.conf_path)
        self.assertEqual(restored["nirmaan_users"], 1)
        self.assertEqual(self._state(), before, "every fixture value is back, the encrypted rows byte-equal")
        with open(self.conf_path) as fh:
            self.assertEqual(json.load(fh), self.conf_before, "keys absent before are removed again")

    def test_the_backup_never_holds_a_decrypted_secret(self):
        backup, _changed = iso.isolate([], names=self.scope, config_path=self.conf_path)
        stored = {r[3] for r in backup["asset_secrets"] + backup["api_secrets"]}
        self.assertTrue(all(v.startswith("enc-") for v in stored), "raw __Auth rows, as stored")
        iso.restore(backup, config_path=self.conf_path)

    def test_isolate_is_idempotent(self):
        backup, _ = iso.isolate([], names=self.scope, config_path=self.conf_path)
        _again, changed = iso.isolate([], names=self.scope, config_path=self.conf_path)
        self.assertEqual({k: v for k, v in changed.items() if k != "api_secrets"},
                         {"config": 0, "email_accounts": 0, "stopped": 0, "nirmaan_users": 0, "token_cache": 0,
                          "asset_secrets": 0})
        iso.restore(backup, config_path=self.conf_path)

    def test_a_missing_stopped_job_name_aborts(self):
        with self.assertRaises(SystemExit):
            iso.isolate_stopped({}, ["zz_no_such_job.nothing"])
