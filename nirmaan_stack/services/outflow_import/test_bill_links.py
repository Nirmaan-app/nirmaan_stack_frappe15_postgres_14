# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The bill-link expiry check of the Cashbook Statement upload (#1590, ADR-0015 Amendment B decision 2).

Pure: `now` is handed in, so the fixture's links (all expired by now in real time) stay testable.
The fixture's earliest link expiry is 2026-11-06 09:00 UTC (see `test_parser._STATEMENT`).
"""

import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from nirmaan_stack.services.outflow_import.bill_links import (
    earliest_link_expiry,
    expired_links_refusal,
    link_expires_at,
)
from nirmaan_stack.services.outflow_import.parser import parse_statement

FIXTURES = Path(__file__).parent / "tests" / "fixtures"
IST = ZoneInfo("Asia/Kolkata")
EARLIEST = datetime(2026, 11, 6, 9, 0, tzinfo=timezone.utc)


def _statement_rows():
    return parse_statement((FIXTURES / "cashbook_statement.xlsx").read_bytes(), source="Cashbook").rows


def _link(signed="20261031T111200Z", lifetime="604800"):
    return (
        "https://storage.googleapis.com/prod-payments-private/transaction-attachments/T/1.jpeg"
        "?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=a%2F20261031%2Fauto%2Fstorage%2Fgoog4_request"
        f"&X-Goog-Date={signed}&X-Goog-Expires={lifetime}&X-Goog-SignedHeaders=host&X-Goog-Signature=ab"
    )


class TestLinkExpiry(unittest.TestCase):
    def test_a_link_expires_its_lifetime_after_it_was_signed(self):
        self.assertEqual(link_expires_at(_link()), datetime(2026, 11, 7, 11, 12, tzinfo=timezone.utc))

    def test_a_link_without_a_signing_date_and_lifetime_has_no_expiry_to_read(self):
        self.assertIsNone(link_expires_at("https://storage.googleapis.com/b/o.jpeg"))
        self.assertIsNone(link_expires_at(_link(lifetime="soon")))

    def test_the_file_expires_with_its_earliest_link(self):
        self.assertEqual(earliest_link_expiry(_statement_rows()), EARLIEST)


class TestExpiredLinksRefusal(unittest.TestCase):
    def test_a_fresh_file_is_accepted(self):
        self.assertIsNone(expired_links_refusal(_statement_rows(), now=EARLIEST - timedelta(days=5)))

    def test_a_file_whose_links_expired_is_refused_naming_the_date(self):
        refusal = expired_links_refusal(_statement_rows(), now=EARLIEST + timedelta(days=1), tz=IST)
        self.assertEqual(refusal, "Links expired on 06-Nov-2026 14:30. Export the statement again.")

    def test_a_file_whose_links_expire_in_under_an_hour_is_refused(self):
        refusal = expired_links_refusal(
            _statement_rows(), now=EARLIEST - timedelta(minutes=59), tz=IST
        )
        self.assertEqual(refusal, "Links expired on 06-Nov-2026 14:30. Export the statement again.")

    def test_a_file_whose_links_last_exactly_an_hour_more_is_accepted(self):
        self.assertIsNone(
            expired_links_refusal(_statement_rows(), now=EARLIEST - timedelta(hours=1))
        )

    def test_the_date_is_named_in_utc_when_no_zone_is_given(self):
        refusal = expired_links_refusal(_statement_rows(), now=EARLIEST + timedelta(days=1))
        self.assertIn("06-Nov-2026 09:00", refusal)

    def test_a_file_with_no_links_has_nothing_to_expire(self):
        rows = [row for row in _statement_rows() if not row.bill_links]
        self.assertTrue(rows)
        self.assertIsNone(expired_links_refusal(rows, now=EARLIEST + timedelta(days=365)))
