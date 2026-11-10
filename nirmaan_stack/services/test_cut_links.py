# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Which stored link looks cut by the old 140-character limit (#1680). Pure: no site, no DB.

Run:  devenv.sh unit nirmaan_stack.services.test_cut_links
"""

import unittest

from nirmaan_stack.services.cut_links import LINK_FIELDS, why_cut

DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view"


class TestWhyCut(unittest.TestCase):
    def test_a_whole_link_does_not_look_cut(self):
        for value in (DRIVE, DRIVE + "?usp=sharing", DRIVE + "?usp=drive_link&ouid=1", "", None):
            with self.subTest(value=value):
                self.assertIsNone(why_cut(value))

    def test_a_google_sheets_share_link_of_138_characters_is_whole(self):
        # The longest values on the 2026-11-07 data: whole links that end in Google's own `&rtpof=true&sd=true`.
        value = (
            "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit"
            "?usp=drive_link&ouid=000000000000000000000&rtpof=true&sd=true"
        )
        self.assertEqual(len(value), 138)
        self.assertIsNone(why_cut(value))

    def test_a_value_of_exactly_140_characters_looks_cut(self):
        value = (DRIVE + "?usp=sharing&x=" + "a" * 200)[:140]
        self.assertEqual(len(value), 140)
        self.assertEqual(why_cut(value), "exactly 140 characters, the old limit")

    def test_a_stored_value_of_140_characters_ending_in_a_space_looks_cut(self):
        value = (DRIVE + "?usp=sharing&x=" + "a" * 200)[:139] + " "
        self.assertEqual(why_cut(value), "exactly 140 characters, the old limit")

    def test_a_value_that_stops_mid_parameter_looks_cut(self):
        for value, ending in (
            (DRIVE + "?usp=sharing&", "&"),
            (DRIVE + "?", "?"),
            (DRIVE + "?usp=", "="),
            (DRIVE + "?usp=drive_link&name=Floor%2", "%2"),
        ):
            with self.subTest(value=value):
                self.assertEqual(why_cut(value), f"ends mid-parameter with `{ending}`")

    def test_surrounding_spaces_do_not_hide_a_cut(self):
        self.assertEqual(why_cut(f"  {DRIVE}?usp=sharing&  "), "ends mid-parameter with `&`")

    def test_it_reads_the_five_link_fields_of_1680(self):
        self.assertEqual(
            sorted(LINK_FIELDS),
            [
                ("Commission Report Task Child Table", "file_link"),
                ("Customer PO Child Table", "customer_po_link"),
                ("Design Tracker Task Child Table", "file_link"),
                ("Project Billing", "bill_document_link"),
                ("Project Drive Link Child Table", "drive_link"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
