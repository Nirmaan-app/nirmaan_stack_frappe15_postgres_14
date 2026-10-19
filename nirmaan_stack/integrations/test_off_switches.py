"""CU-A AC5: the two dev-only off-switches, `disable_push` and `disable_cloud_upload`.

MOCKED THROUGHOUT: `firebase_admin.messaging.send` and the storage app's upload / delete handlers are
patched for every test, so no real push or upload can happen whatever the switch says. The switches
are set with patch.dict on frappe.conf for one test only; the site config is never written here.
"""
import os
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.integrations.controllers import file as file_hooks
from nirmaan_stack.integrations.Notifications import pr_notifications

TOKEN = "TEST_CUA_FAKE_TOKEN_never_sent"


def _appended(logname, action):
    """Run `action` with the REAL logger and return what it appended to logs/<logname>.log -- the join
    a mocked logger cannot prove (Frappe file loggers drop anything below WARNING)."""
    path = os.path.join(frappe.utils.get_bench_path(), "logs", f"{logname}.log")
    start = os.path.getsize(path) if os.path.exists(path) else 0
    action()
    with open(path, encoding="utf-8") as fh:
        fh.seek(start)
        return fh.read()


class TestDisablePush(FrappeTestCase):

    def setUp(self):
        sender = patch.object(pr_notifications.messaging, "send", return_value="mock-id")
        self.send = sender.start()
        self.addCleanup(sender.stop)

    def test_with_the_switch_off_the_send_is_called(self):
        with patch.dict(frappe.conf, {"disable_push": 0}):
            pr_notifications.send_firebase_notification(TOKEN, "Title A", "Body", "/x")
        self.send.assert_called_once()
        self.assertEqual(self.send.call_args[0][0].token, TOKEN)

    def test_with_the_switch_on_nothing_is_sent_and_the_line_is_logged(self):
        logger = MagicMock()
        with patch.dict(frappe.conf, {"disable_push": 1}), \
                patch.object(pr_notifications.frappe, "logger", return_value=logger) as get_logger:
            pr_notifications.send_firebase_notification(TOKEN, "Title B", "Secret body", "/x")
        self.send.assert_not_called()
        get_logger.assert_called_with("nirmaan_push", allow_site=True)
        line = logger.info.call_args[0][0]
        self.assertIn("'Title B'", line)
        self.assertIn("1 recipient", line)
        self.assertNotIn(TOKEN, line, "the token is never logged")
        self.assertNotIn("Secret body", line, "the body is never logged")

    def test_the_push_line_reaches_the_log_file(self):
        title = f"CU-A push probe {frappe.generate_hash(length=6)}"
        with patch.dict(frappe.conf, {"disable_push": 1}):
            text = _appended("nirmaan_push", lambda: pr_notifications.send_firebase_notification(TOKEN, title, "b", "/x"))
        self.assertIn(title, text)
        self.assertNotIn(TOKEN, text)
        self.send.assert_not_called()

    def test_every_caller_goes_through_the_guarded_function(self):
        # PrNotification -> send_firebase_notification is the only path to messaging.send.
        lead = {"name": "x@example.com", "fcm_token": TOKEN}
        with patch.dict(frappe.conf, {"disable_push": 1}):
            pr_notifications.PrNotification(lead, "Title C", "Body", "/x")
        self.send.assert_not_called()


class TestDisableCloudUpload(FrappeTestCase):

    def setUp(self):
        frappe.db.rollback()
        up = patch("frappe_gcp_attachment.controller.file_upload_to_gcs")
        rm = patch("frappe_gcp_attachment.controller.delete_from_cloud")
        self.upload = up.start()
        self.cloud_delete = rm.start()
        self.addCleanup(up.stop)
        self.addCleanup(rm.stop)
        # the switch's removal lasts for the request; a test process is one long "request"
        self.addCleanup(setattr, frappe.local, "doc_events_hooks", None)
        frappe.local.doc_events_hooks = None
        self.files = []
        self.addCleanup(self._purge)

    def _purge(self):
        frappe.db.rollback()
        for name in self.files:
            try:
                frappe.delete_doc("File", name, force=True, ignore_permissions=True)  # removes the local copy
                frappe.db.commit()
            except Exception as e:
                frappe.db.rollback()
                raise AssertionError(f"cleanup failed: {name}: {e}")

    def _new_file(self):
        doc = frappe.get_doc({"doctype": "File", "file_name": f"test_cua_switch_{frappe.generate_hash(length=6)}.txt",
                              "content": b"cu-a probe", "is_private": 1})
        doc.insert(ignore_permissions=True)
        self.files.append(doc.name)
        return doc

    def test_the_gcp_upload_is_hooked_on_this_site(self):
        # Guards the premise: the handler this switch removes is the one Frappe would call.
        self.assertIn(file_hooks.GCP_UPLOAD, frappe.get_doc_hooks()["File"]["after_insert"])

    def test_with_the_switch_off_the_upload_is_called(self):
        with patch.dict(frappe.conf, {"disable_cloud_upload": 0}):
            doc = self._new_file()
        self.upload.assert_called_once()
        self.assertEqual(self.upload.call_args[0][0].name, doc.name)

    def test_with_the_switch_on_the_file_stays_local_and_the_line_is_logged(self):
        logger = MagicMock()
        with patch.dict(frappe.conf, {"disable_cloud_upload": 1}), \
                patch.object(file_hooks.frappe, "logger", return_value=logger):
            doc = self._new_file()
        self.upload.assert_not_called()
        self.assertTrue(doc.file_url.startswith("/private/files/"), doc.file_url)
        self.assertTrue(os.path.exists(doc.get_full_path()))
        self.assertIn("stays local", logger.info.call_args[0][0])

    def test_the_upload_line_reaches_the_log_file(self):
        holder = {}
        with patch.dict(frappe.conf, {"disable_cloud_upload": 1}):
            text = _appended("nirmaan_cloud_upload", lambda: holder.setdefault("doc", self._new_file()))
        self.assertIn(holder["doc"].file_name, text)
        self.upload.assert_not_called()

    def test_the_switch_is_read_per_insert(self):
        with patch.dict(frappe.conf, {"disable_cloud_upload": 1}):
            self._new_file()
        frappe.local.doc_events_hooks = None   # a new request
        with patch.dict(frappe.conf, {"disable_cloud_upload": 0}):
            self._new_file()
        self.assertEqual(self.upload.call_count, 1)

    def test_the_hook_is_wired(self):
        self.assertIn("nirmaan_stack.integrations.controllers.file.before_insert",
                      frappe.get_hooks("doc_events")["File"]["before_insert"])
