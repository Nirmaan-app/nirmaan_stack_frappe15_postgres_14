# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""The old download-token folder goes once nothing writes to it (#1664): the patch removes its leftover files.

Runs on a folder of its own in the system temp dir, never on the site's real `public/files/temp_downloads`.
"""

import os
import shutil
import tempfile
import unittest

from nirmaan_stack.patches.v3_0 import remove_temp_downloads_folder as patch


class TestTempDownloadsRemoved(unittest.TestCase):
	def setUp(self):
		self.root = tempfile.mkdtemp()
		self.addCleanup(shutil.rmtree, self.root, True)
		self.folder = os.path.join(self.root, "temp_downloads")

	def test_leftover_finished_files_and_the_folder_go(self):
		os.makedirs(self.folder)
		for name in ("a1b2.bin", "c3d4.bin"):
			with open(os.path.join(self.folder, name), "wb") as f:
				f.write(b"%PDF-1.4 leftover")

		self.assertEqual(patch.remove_leftovers(self.folder), 2)
		self.assertFalse(os.path.exists(self.folder))

	def test_a_file_the_token_path_never_wrote_is_kept_and_so_is_the_folder(self):
		os.makedirs(self.folder)
		with open(os.path.join(self.folder, "notes.txt"), "w") as f:
			f.write("not ours")

		self.assertEqual(patch.remove_leftovers(self.folder), 0)
		self.assertTrue(os.path.exists(os.path.join(self.folder, "notes.txt")))

	def test_a_site_without_the_folder_is_left_alone_and_a_rerun_is_safe(self):
		self.assertEqual(patch.remove_leftovers(self.folder), 0)
		self.assertEqual(patch.remove_leftovers(self.folder), 0)
