# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""`split_repeats` -- the one exact-repeat walk behind the Cashfree/ICICI and Cashbook plans."""

import unittest
from types import SimpleNamespace

from nirmaan_stack.services.outflow_import.duplicates import PriorSighting
from nirmaan_stack.services.outflow_import.repeats import split_repeats


def _line(tid, status="SUCCESS"):
    return SimpleNamespace(transfer_id=tid, status_raw=status)


def _split(rows, earlier=None, **rule):
    earlier = earlier or {}
    return split_repeats(
        rows,
        identity_of=lambda row: row.transfer_id,
        earlier_sightings_of=lambda row: earlier.get(row.transfer_id, ()),
        **rule,
    )


def _seen(label, status):
    return PriorSighting(added_on_date=None, label=label, bank_status=status)


class TestSplitRepeats(unittest.TestCase):
    def test_a_line_nobody_holds_is_kept_with_no_repeat(self):
        split = _split([_line("A")])
        self.assertEqual(len(split.kept), 1)
        self.assertIsNone(split.kept[0].earlier)
        self.assertEqual((split.repeats_not_saved, split.repeat_of_batch), (0, None))

    def test_an_earlier_import_with_the_same_status_is_left_out_and_named(self):
        split = _split([_line("A")], {"A": (_seen("OFI-1", "SUCCESS"),)})
        self.assertEqual((split.kept, split.repeats_not_saved, split.repeat_of_batch), ((), 1, "OFI-1"))

    def test_a_changed_status_is_kept_carrying_the_earlier_one(self):
        split = _split([_line("A", "REVERSED")], {"A": (_seen("OFI-1", "SUCCESS"),)})
        (line,) = split.kept
        self.assertEqual((line.earlier.label, line.earlier.earlier_status, line.earlier.exact),
                         ("OFI-1", "SUCCESS", False))

    def test_an_in_file_copy_is_left_out_but_names_no_batch(self):
        split = _split([_line("A"), _line("A")])
        self.assertEqual((len(split.kept), split.repeats_not_saved, split.repeat_of_batch), (1, 1, None))

    def test_an_in_file_status_change_is_kept(self):
        split = _split([_line("A"), _line("A", "REVERSED")])
        self.assertEqual(split.kept[1].in_file.earlier_status, "SUCCESS")

    def test_an_in_flight_line_makes_no_later_line_a_repeat(self):
        split = _split([_line("A", "PENDING"), _line("A")])
        self.assertEqual((len(split.kept), split.repeats_not_saved), (2, 0))

    def test_the_first_exact_earlier_batch_is_the_one_named(self):
        split = _split(
            [_line("A"), _line("B")],
            {"A": (_seen("OFI-1", "SUCCESS"),), "B": (_seen("OFI-2", "SUCCESS"),)},
        )
        self.assertEqual(split.repeat_of_batch, "OFI-1")

    def test_a_failed_line_is_a_sighting_by_default(self):
        """Cashfree/ICICI: every TERMINAL line is a sighting, whatever its own outcome."""
        split = _split([_line("A", "FAILED"), _line("A", "FAILED")])
        self.assertEqual((len(split.kept), split.repeats_not_saved), (1, 1))


class TestACallersInFileRule(unittest.TestCase):
    """Cashbook's in-file sighting is a line that will be CREATED, not every terminal line (#1358)."""

    @staticmethod
    def _created_only(line):
        return line.row.status_raw == "SUCCESS" and line.earlier is None and line.in_file is None

    def test_a_line_the_rule_refuses_makes_no_later_line_a_repeat(self):
        split = _split(
            [_line("A", "FAILED"), _line("A")], is_in_file_sighting=self._created_only
        )
        self.assertEqual((len(split.kept), split.repeats_not_saved), (2, 0))
        self.assertIsNone(split.kept[1].in_file)

    def test_a_line_the_rule_accepts_still_makes_its_copy_a_repeat(self):
        split = _split([_line("A"), _line("A")], is_in_file_sighting=self._created_only)
        self.assertEqual((len(split.kept), split.repeats_not_saved), (1, 1))

    def test_the_rule_sees_each_line_after_it_is_judged(self):
        seen = []
        _split(
            [_line("A"), _line("A")],
            is_in_file_sighting=lambda line: seen.append(line.in_file) or True,
        )
        self.assertIsNone(seen[0])
        self.assertTrue(seen[1].exact)
