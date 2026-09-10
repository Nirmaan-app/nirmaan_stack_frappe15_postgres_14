# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `services.outflow_import.settlement_reference` -- the ONE resolution (ADR-0020 B9).

Pure: no bench, no fixtures, no database. The DB-level behaviour this answer drives lives in
`api/outflow_import/test_upload.py` (the value landing on the staged row) and
`api/outflow_import/test_settle_payment.py` (the five write sites reading it, and the negative
test proving the matcher and the collision guard never do).
"""

import unittest

from nirmaan_stack.services.outflow_import.parser import SUPPORTED_SOURCES
from nirmaan_stack.services.outflow_import.settlement_reference import (
    resolve_settlement_reference,
    settlement_reference_of_row,
)
from nirmaan_stack.services.outflow_import.sources import (
    TRANSFER_ID_REFERENCE_SOURCES,
    source_transfer_id_is_its_reference,
)


def _resolve(**overrides):
    """A Cashfree row with every reference field blank, unless the case says otherwise."""
    kwargs = {
        "bank_reference_no": "",
        "reference_id": "",
        "transfer_id": "",
        "source": "Cashfree",
    }
    kwargs.update(overrides)
    return resolve_settlement_reference(**kwargs)


class TestTheLadder(unittest.TestCase):
    def test_the_bank_reference_wins_when_it_is_there(self):
        self.assertEqual(
            _resolve(bank_reference_no="UTR123", reference_id="CF-9", transfer_id="TR-1"),
            "UTR123",
        )

    def test_the_gateway_reference_is_next(self):
        self.assertEqual(_resolve(reference_id="CF-9", transfer_id="TR-1"), "CF-9")

    def test_the_wallet_transfer_id_is_last_and_only_for_the_wallet_source(self):
        self.assertEqual(_resolve(transfer_id="TR-1", source="Cashbook"), "TR-1")

    def test_a_gateway_source_does_not_fall_back_to_its_transfer_id(self):
        """⚠️ THE THIRD RUNG IS PER-SOURCE, and that is the whole reason the ladder is here rather
        than at a write site. A gateway's `transfer_id` is not a settlement reference; widening the
        fallback to every source would put one on 2,237 Cashfree rows that the owner never asked
        for, and it would do it invisibly."""
        self.assertEqual(_resolve(transfer_id="TR-1", source="Cashfree"), "")
        self.assertEqual(_resolve(transfer_id="TR-1", source="ICICI Bank Statement"), "")

    def test_nothing_anywhere_resolves_to_blank(self):
        self.assertEqual(_resolve(), "")

    def test_every_supported_source_resolves_a_bank_reference_the_same_way(self):
        for source in SUPPORTED_SOURCES:
            self.assertEqual(_resolve(bank_reference_no="UTR123", source=source), "UTR123", source)


class TestWhitespaceAndAbsence(unittest.TestCase):
    """⚠️ A WHITESPACE-ONLY VALUE IS AN ABSENCE, NOT A REFERENCE. 226 stored references on the live
    ledger are whitespace-padded; a padded blank that survived the ladder would be written onto a
    payment as a reference an accountant can neither see nor search for."""

    def test_a_whitespace_only_bank_reference_falls_through(self):
        self.assertEqual(_resolve(bank_reference_no="   ", reference_id="CF-9"), "CF-9")

    def test_a_whitespace_only_gateway_reference_falls_through(self):
        self.assertEqual(
            _resolve(reference_id="  ", transfer_id="TR-1", source="Cashbook"), "TR-1"
        )

    def test_a_whitespace_only_transfer_id_resolves_to_blank(self):
        self.assertEqual(_resolve(transfer_id="  ", source="Cashbook"), "")

    def test_the_resolved_value_is_stripped(self):
        self.assertEqual(_resolve(bank_reference_no="  UTR123  "), "UTR123")

    def test_none_is_read_as_absent_on_every_rung(self):
        """The parser always hands strings, but a persisted row hands `None` for an empty column and
        a backfill reads persisted rows."""
        self.assertEqual(
            resolve_settlement_reference(
                bank_reference_no=None, reference_id=None, transfer_id=None, source=None
            ),
            "",
        )
        self.assertEqual(
            resolve_settlement_reference(
                bank_reference_no=None,
                reference_id=None,
                transfer_id="TR-1",
                source="Cashbook",
            ),
            "TR-1",
        )


class TestTheWalletSourceQuestion(unittest.TestCase):
    def test_the_wallet_source_answers_yes(self):
        self.assertTrue(source_transfer_id_is_its_reference("Cashbook"))

    def test_a_gateway_and_a_passbook_answer_no(self):
        self.assertFalse(source_transfer_id_is_its_reference("Cashfree"))
        self.assertFalse(source_transfer_id_is_its_reference("ICICI Bank Statement"))

    def test_the_predicate_is_the_set_read_both_directions(self):
        self.assertTrue(TRANSFER_ID_REFERENCE_SOURCES)
        for source in SUPPORTED_SOURCES:
            self.assertEqual(
                source_transfer_id_is_its_reference(source),
                source in TRANSFER_ID_REFERENCE_SOURCES,
                source,
            )

    def test_an_unknown_source_answers_no(self):
        """⚠️ THE DIRECTION OF THE DEFAULT IS THE TEST. Defaulting yes would put a gateway's own
        transfer id onto a payment's reference on any source nobody has thought about yet -- a
        value written into the ledger, announced nowhere. Defaulting no leaves such a row exactly
        where it is today: blank, and visibly so."""
        for source in ("", "   ", None, "Some Future Gateway"):
            self.assertFalse(source_transfer_id_is_its_reference(source), repr(source))


class TestThePersistedRowAccessor(unittest.TestCase):
    """`settlement_reference_of_row` -- the stored column, else the ladder recomputed.

    ⚠️ THE RECOMPUTE IS THE DEPLOY-WINDOW FLOOR. The backfill's `patches.txt` wiring is added
    separately by the maintainer, so the code can be live while the column is still NULL on every
    existing row; a reader taking the column alone would settle every one of them with a BLANK.
    """

    def test_the_stored_column_wins_when_it_has_one(self):
        self.assertEqual(
            settlement_reference_of_row(
                {
                    "settlement_reference": "STORED",
                    "bank_reference_no": "UTR",
                    "reference_id": "GW",
                    "transfer_id": "TR",
                    "source": "Cashbook",
                }
            ),
            "STORED",
        )

    def test_a_blank_column_recomputes_the_whole_ladder(self):
        row = {
            "settlement_reference": None,
            "bank_reference_no": "",
            "reference_id": "",
            "transfer_id": "TR-1",
            "source": "Cashbook",
        }
        self.assertEqual(settlement_reference_of_row(row), "TR-1")

    def test_the_recompute_keeps_the_wallet_rung(self):
        """⚠️ THE REGRESSION AN EARLIER DRAFT SHIPPED. Flooring on `bank_reference_no` alone looked
        harmless and silently dropped the third rung: a pre-backfill wallet row would have written a
        BLANK where the deleted per-site override wrote its transaction id -- the very source this
        design exists to reach. The floor goes through the one resolver for exactly this reason."""
        wallet = {
            "settlement_reference": "",
            "bank_reference_no": "",
            "reference_id": "",
            "transfer_id": "OBO-123",
            "source": "Cashbook",
        }
        self.assertEqual(settlement_reference_of_row(wallet), "OBO-123")
        # and the gateway is still refused its own transfer id
        self.assertEqual(settlement_reference_of_row({**wallet, "source": "Cashfree"}), "")

    def test_a_whitespace_only_column_is_an_absence_and_recomputes(self):
        self.assertEqual(
            settlement_reference_of_row(
                {
                    "settlement_reference": "   ",
                    "bank_reference_no": "UTR-9",
                    "reference_id": "",
                    "transfer_id": "TR",
                    "source": "Cashfree",
                }
            ),
            "UTR-9",
        )

    def test_a_row_with_nothing_at_all_resolves_to_blank(self):
        self.assertEqual(settlement_reference_of_row({}), "")


if __name__ == "__main__":
    unittest.main()
