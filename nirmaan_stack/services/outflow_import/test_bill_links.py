# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The bill-link expiry check of the Cashbook Statement upload (#1590, ADR-0015 Amendment B decision 2).

Pure: `now` is handed in, so the fixture's links (all expired by now in real time) stay testable.
The fixture's earliest link expiry is 2026-11-06 09:00 UTC (see `test_parser._STATEMENT`).
"""

import csv
import io
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from openpyxl import load_workbook

from nirmaan_stack.services.outflow_import.bill_links import (
    LINKS_UNREADABLE_MESSAGE,
    earliest_link_expiry,
    expired_link_reason,
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


#: 2026-11-07 09:30 UTC, 15:00 IST, as a V2 `Expires` (Unix seconds).
V2_EXPIRES = datetime(2026, 11, 7, 9, 30, tzinfo=timezone.utc)


def _v2_link(expires="1794043800"):
    """A link as the provider signs it (Google Cloud Storage V2): `Expires` is the Unix second it dies."""
    return (
        "https://storage.googleapis.com/prod-payments-private/transaction-attachments/T/1.jpeg"
        f"?GoogleAccessId=signer%40made-up.iam.gserviceaccount.com&Expires={expires}&Signature=ab%2Fcd%3D"
    )


#: Every statement fixture that carries bill links: how many, and the instants their `Expires` name.
FIXTURE_LINKS = {
    "cashbook_statement.xlsx": (
        12,
        {datetime(2026, 11, 7, 11, 12, tzinfo=timezone.utc), datetime(2026, 11, 6, 9, 0, tzinfo=timezone.utc)},
    ),
    "cashbook_sample.xlsx": (4, {datetime(2100, 1, 7, tzinfo=timezone.utc)}),
    "cashbook_sample.csv": (4, {datetime(2100, 1, 7, tzinfo=timezone.utc)}),
    "cashbook_no_remark.csv": (1, {datetime(2100, 1, 7, tzinfo=timezone.utc)}),
}


def _fixture_links(name: str) -> list[str]:
    """Every bill link a fixture carries, read off the file itself and not through the parser: a workbook's cell
    hyperlinks, a CSV's URL cells."""
    path = FIXTURES / name
    if path.suffix == ".csv":
        rows = csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig")))
        return [cell for row in rows for cell in row if cell.startswith("https://")]
    book = load_workbook(path)
    return [cell.hyperlink.target for row in book.active.iter_rows() for cell in row if cell.hyperlink]


class TestFixtureLinksAreSignedLikeTheProvider(unittest.TestCase):
    """The provider signs its bill links V2. A fixture whose links drift to another shape (the V4 ones #1590 shipped
    with) lets a reader that cannot read the provider's links pass every test here and refuse every real statement."""

    def test_every_fixture_link_is_a_v2_signed_url_with_a_readable_expiry(self):
        for name, (count, expiries) in FIXTURE_LINKS.items():
            links = _fixture_links(name)
            with self.subTest(fixture=name):
                self.assertEqual(len(links), count)
                for link in links:
                    query = urlsplit(link).query
                    self.assertEqual(set(parse_qs(query)), {"GoogleAccessId", "Expires", "Signature"}, link)
                    signature = query.split("Signature=", 1)[1]
                    self.assertNotIn("+", signature, link)
                    self.assertTrue("%2B" in signature or "%2F" in signature, link)
                self.assertEqual({link_expires_at(link) for link in links}, expiries)


class TestLinkExpiry(unittest.TestCase):
    def test_a_link_expires_its_lifetime_after_it_was_signed(self):
        self.assertEqual(link_expires_at(_link()), datetime(2026, 11, 7, 11, 12, tzinfo=timezone.utc))

    def test_a_v2_link_expires_at_its_expires_instant(self):
        self.assertEqual(link_expires_at(_v2_link()), V2_EXPIRES)

    def test_a_link_without_a_signing_date_and_lifetime_has_no_expiry_to_read(self):
        self.assertIsNone(link_expires_at("https://storage.googleapis.com/b/o.jpeg"))
        self.assertIsNone(link_expires_at(_link(lifetime="soon")))
        self.assertIsNone(link_expires_at(_v2_link(expires="soon")))

    def test_the_file_expires_with_its_earliest_link(self):
        self.assertEqual(earliest_link_expiry(_statement_rows()), EARLIEST)


class TestExpiredLinkReason(unittest.TestCase):
    """Code review R2: one link past its expiry is not requested; the reason names the expiry in the site's zone."""

    EXPIRES = datetime(2026, 11, 7, 11, 12, tzinfo=timezone.utc)

    def test_a_live_link_has_no_reason(self):
        self.assertIsNone(expired_link_reason(_link(), now=self.EXPIRES - timedelta(seconds=1)))

    def test_a_link_at_or_past_its_expiry_names_the_date(self):
        for now in (self.EXPIRES, self.EXPIRES + timedelta(days=3)):
            self.assertEqual(expired_link_reason(_link(), now=now, tz=IST), "its link expired on 07-Nov-2026 16:42")

    def test_a_link_that_does_not_say_when_it_dies_is_tried(self):
        self.assertIsNone(expired_link_reason("https://storage.googleapis.com/b/o.jpeg", now=self.EXPIRES))

    def test_a_v2_link_past_its_expires_names_the_date(self):
        self.assertIsNone(expired_link_reason(_v2_link(), now=V2_EXPIRES - timedelta(seconds=1)))
        self.assertEqual(
            expired_link_reason(_v2_link(), now=V2_EXPIRES + timedelta(days=3), tz=IST),
            "its link expired on 07-Nov-2026 15:00",
        )


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

    def test_a_file_whose_links_carry_no_readable_expiry_is_refused(self):
        """Spec #1585 code review S4: nothing can be said about when such a link dies, so the import cannot promise
        to fetch its bill; a statement as the provider exports it signs every link."""
        unsigned = "https://storage.googleapis.com/prod-payments-private/transaction-attachments/T/2.jpeg"
        for links in ((unsigned,), (_link(), unsigned), (_link(lifetime="soon"),), (_v2_link(expires="soon"),)):
            with self.subTest(links=links):
                rows = [SimpleNamespace(bill_links=links)]
                self.assertEqual(
                    expired_links_refusal(rows, now=EARLIEST - timedelta(days=5)), LINKS_UNREADABLE_MESSAGE
                )

    def test_a_file_of_live_v2_links_is_accepted(self):
        """The provider signs its links V2 (`Expires`); the real statement's are all of that shape."""
        rows = [SimpleNamespace(bill_links=(_v2_link(),)), SimpleNamespace(bill_links=(_v2_link(), _link()))]
        self.assertIsNone(expired_links_refusal(rows, now=V2_EXPIRES - timedelta(days=5)))

    def test_a_file_whose_v2_links_expire_in_under_an_hour_is_refused_naming_the_date(self):
        rows = [SimpleNamespace(bill_links=(_v2_link(),))]
        refusal = expired_links_refusal(rows, now=V2_EXPIRES - timedelta(minutes=59), tz=IST)
        self.assertEqual(refusal, "Links expired on 07-Nov-2026 15:00. Export the statement again.")

    def test_a_file_with_no_links_has_nothing_to_expire(self):
        rows = [row for row in _statement_rows() if not row.bill_links]
        self.assertTrue(rows)
        self.assertIsNone(expired_links_refusal(rows, now=EARLIEST + timedelta(days=365)))
