# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""`stored_files.store_file`: bytes our code holds become ONE file on disk, the one the File's `file_url` names.

A dev env keeps uploads on local disk (the storage app's upload is off), so the disk is read directly: the
production leak of 2026-11-07 was a second, unnamed copy beside each stored bill, invisible to any File query.

Run: DEVENV test --module nirmaan_stack.services.test_stored_files
"""

from pathlib import Path

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils.file_manager import MaxFileSizeReachedError, get_max_file_size

from nirmaan_stack.services.stored_files import store_file


class TestStoreFile(FrappeTestCase):
    def setUp(self):
        self.files_dir = Path(frappe.get_site_path("private", "files"))
        self.before = {path.name for path in self.files_dir.iterdir()}
        self.saved: list[str] = []
        self.addCleanup(self._remove)

    def _new_files(self) -> list[str]:
        return sorted({path.name for path in self.files_dir.iterdir()} - self.before)

    def _remove(self):
        """The test's own rows and every file it left on disk; a raw delete, because the storage app's `on_trash`
        would look for the bytes in a bucket."""
        frappe.db.rollback()
        for name in self.saved:
            frappe.db.delete("File", {"name": name})
        frappe.db.delete("Comment", {"reference_doctype": "User", "reference_name": "Administrator",
                                     "comment_type": "Attachment", "content": ["like", "%made-up-%"]})
        frappe.db.commit()
        for name in self._new_files():
            (self.files_dir / name).unlink()

    def test_the_bytes_are_written_once_under_the_name_file_url_gives(self):
        content = b"\x89PNG made-up bill " + frappe.generate_hash(length=32).encode()

        doc = store_file(f"made-up-{frappe.generate_hash(length=6)}.png", content, is_private=1)

        self.saved.append(doc.name)
        row = frappe.db.get_value("File", doc.name, ["file_url", "is_private", "attached_to_doctype"], as_dict=True)
        self.assertEqual(self._new_files(), [row.file_url.rsplit("/", 1)[-1]])
        self.assertEqual((self.files_dir / self._new_files()[0]).read_bytes(), content)
        self.assertEqual((doc.file_url, row.is_private, row.attached_to_doctype), (row.file_url, 1, None))
        self.assertTrue(row.file_url.startswith("/private/files/"), row.file_url)

    def test_an_attached_file_names_its_record_and_field(self):
        content = b"\x89PNG made-up receipt " + frappe.generate_hash(length=32).encode()

        doc = store_file(f"made-up-{frappe.generate_hash(length=6)}.png", content, "User", "Administrator", df="bio")

        self.saved.append(doc.name)
        row = frappe.db.get_value(
            "File", doc.name, ["attached_to_doctype", "attached_to_name", "attached_to_field", "file_url"], as_dict=True
        )
        self.assertEqual((row.attached_to_doctype, row.attached_to_name, row.attached_to_field), ("User", "Administrator", "bio"))
        self.assertEqual(self._new_files(), [row.file_url.rsplit("/", 1)[-1]])

    def test_a_file_over_the_limit_is_refused_and_nothing_is_written(self):
        with self.assertRaises(MaxFileSizeReachedError):
            store_file("made-up-too-big.png", b"x" * (get_max_file_size() + 1), is_private=1)

        self.assertEqual(self._new_files(), [])
        self.assertFalse(frappe.db.exists("File", {"file_name": "made-up-too-big.png"}))
