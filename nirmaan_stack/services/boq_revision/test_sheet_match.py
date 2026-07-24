# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for nirmaan_stack.services.boq_revision.sheet_match (D3 pairing).

`propose_pairing` is the pairing AUTHORITY's proposal engine: N2 + a PER-SIDE,
PER-KEY count-guard, strict 1:1. It only ever PROPOSES -- the human confirms on
the mapping screen -- so its job is noise control: absorb whitespace/case drift
(F1) into a confident pre-fill, and refuse to guess (blank -> hard stop) wherever
a key is ambiguous on either side. A pre-filled pair is name-identical by
construction, so it can never introduce an F1 error.
"""

import unittest

from nirmaan_stack.services.boq_revision.sheet_match import propose_pairing


class TestProposePairing(unittest.TestCase):
    def _by_name(self, proposal):
        return {p.sheet_name: p for p in proposal.pairings}

    def test_clean_one_to_one_match(self):
        proposal = propose_pairing(["Electrical", "Plumbing"], ["Electrical", "Plumbing"])
        by = self._by_name(proposal)
        self.assertEqual(by["Electrical"].status, "matched")
        self.assertEqual(by["Electrical"].proposed_source, "Electrical")
        self.assertEqual(by["Plumbing"].proposed_source, "Plumbing")
        self.assertFalse(proposal.self_collision)

    def test_whitespace_and_case_drift_still_matches(self):
        # F1: the revised tab drifted to 'Electrical ' / 'ELECTRICAL'; N2 rescues it,
        # and the proposed source is the ORIGINAL's VERBATIM name (#152).
        proposal = propose_pairing(["Electrical ", "ELECTRICAL 2"], ["Electrical", "Electrical 2"])
        by = self._by_name(proposal)
        self.assertEqual(by["Electrical "].status, "matched")
        self.assertEqual(by["Electrical "].proposed_source, "Electrical")
        self.assertEqual(by["ELECTRICAL 2"].proposed_source, "Electrical 2")

    def test_no_committed_candidate_is_unmatched(self):
        proposal = propose_pairing(["Brand New Sheet"], ["Electrical"])
        by = self._by_name(proposal)
        self.assertEqual(by["Brand New Sheet"].status, "unmatched")
        self.assertIsNone(by["Brand New Sheet"].proposed_source)

    def test_electrical_and_electrical_2_never_merge(self):
        # A revised 'Electrical 2' must NOT be pre-filled with the original 'Electrical'.
        proposal = propose_pairing(["Electrical 2"], ["Electrical"])
        by = self._by_name(proposal)
        self.assertEqual(by["Electrical 2"].status, "unmatched")

    def test_incoming_self_collision_routes_to_human(self):
        # BOQ-26-00006's real shape: one workbook holding both 'SUMMARY ' and 'Summary'.
        # PER-SIDE guard: the incoming side self-collides on the 'summary' key -> BOTH
        # route to human (blank), even though a clean committed 'Summary' exists.
        proposal = propose_pairing(["SUMMARY ", "Summary", "Electrical"], ["Summary", "Electrical"])
        by = self._by_name(proposal)
        self.assertEqual(by["SUMMARY "].status, "unmatched")
        self.assertEqual(by["Summary"].status, "unmatched")
        self.assertTrue(proposal.self_collision)
        # A one-key collision does NOT block the other sheets (per-key guard).
        self.assertEqual(by["Electrical"].status, "matched")
        self.assertEqual(by["Electrical"].proposed_source, "Electrical")

    def test_committed_side_collision_routes_to_human(self):
        # If the committed side is ambiguous on a key, we cannot know which original
        # to point at -> unmatched (self_collision is an INCOMING-side flag, so False).
        proposal = propose_pairing(["Summary"], ["SUMMARY ", "Summary"])
        by = self._by_name(proposal)
        self.assertEqual(by["Summary"].status, "unmatched")
        self.assertFalse(proposal.self_collision)

    def test_strict_one_to_one_falls_out(self):
        # Two distinct revised sheets can never auto-claim the same original, because
        # a clean committed side has unique N2 keys.
        proposal = propose_pairing(["Electrical", "Plumbing"], ["Electrical"])
        by = self._by_name(proposal)
        claimed = [p.proposed_source for p in proposal.pairings if p.proposed_source]
        self.assertEqual(len(claimed), len(set(claimed)))
        self.assertEqual(by["Plumbing"].status, "unmatched")

    def test_order_is_preserved(self):
        proposal = propose_pairing(["C", "A", "B"], ["A", "B", "C"])
        self.assertEqual([p.sheet_name for p in proposal.pairings], ["C", "A", "B"])

    def test_empty_inputs(self):
        proposal = propose_pairing([], ["Electrical"])
        self.assertEqual(proposal.pairings, [])
        self.assertFalse(proposal.self_collision)


if __name__ == "__main__":
    unittest.main()
