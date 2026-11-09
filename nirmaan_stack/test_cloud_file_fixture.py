# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`cloud_file_fixture.cloud_url` makes a stored file URL as long and as shaped as production's (#1678).

Pure: no bench, no site, no DB.  Run:  devenv.sh unit nirmaan_stack.test_cloud_file_fixture
"""

import re
import unittest
from urllib.parse import parse_qs, urlsplit

from nirmaan_stack.cloud_file_fixture import cloud_url

# Production's shape (2026-10-28 data): the key is not encoded, its file name has `_` for spaces, the random
# prefix is 8 upper-case letters and digits, and `file_name` is the original name, URL-encoded.
SHAPE = re.compile(
    r"^/api/method/frappe_gcp_attachment\.controller\.generate_file"
    r"\?key=attachments/\d{4}/\d{2}/\d{2}/(?P<doctype>[^/]+)/[A-Z0-9]{8}_(?P<key_name>[^/&]+)"
    r"&file_name=(?P<file_name>[^&]+)$"
)


class TestCloudUrl(unittest.TestCase):
    def test_a_short_name_still_makes_a_url_of_real_length(self):
        for name in ("a.pdf", "bill.jpeg", "gate-valve-a.pdf"):
            with self.subTest(name=name):
                self.assertTrue(200 <= len(cloud_url(name)) <= 270, len(cloud_url(name)))

    def test_a_long_name_and_doctype_stay_within_real_length(self):
        url = cloud_url("Tax Invoice 2026-27 March Rent Office Premises (1).pdf", "Non Project Expenses")
        self.assertTrue(200 <= len(url) <= 270, len(url))

    def test_it_has_the_storage_apps_shape(self):
        url = cloud_url("site photo.jpeg", "Project Expenses")
        match = SHAPE.match(url)
        self.assertIsNotNone(match, url)
        self.assertEqual(match["doctype"], "Project Expenses")
        self.assertNotIn(" ", match["key_name"])
        stored_name = parse_qs(urlsplit(url).query)["file_name"][0]
        self.assertTrue(stored_name.startswith("site photo"), stored_name)
        self.assertTrue(stored_name.endswith(".jpeg"), stored_name)

    def test_one_name_gives_one_url_so_a_test_can_build_it_again(self):
        self.assertEqual(cloud_url("bill.pdf"), cloud_url("bill.pdf"))
        self.assertNotEqual(cloud_url("bill.pdf"), cloud_url("bill-2.pdf"))
        self.assertNotEqual(cloud_url("bill.pdf"), cloud_url("bill.pdf", "Project Expenses"))


if __name__ == "__main__":
    unittest.main()
