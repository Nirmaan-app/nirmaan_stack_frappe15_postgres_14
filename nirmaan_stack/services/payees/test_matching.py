# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Which Payees look like a new vendor (spec #1420, ADR-0033). Pure; run with `devenv.sh unit`."""

import unittest

from nirmaan_stack.services.payees.matching import (
    NAME_ONLY,
    STRONG,
    Candidate,
    LinkedVendor,
    name_similarity,
    rank_payees,
)


def candidate(payee, holder, *vendors):
    return Candidate(payee=payee, account_name=holder, vendors=tuple(LinkedVendor(n, p) for n, p in vendors))


class TestNameSimilarity(unittest.TestCase):
    def test_the_same_company_reads_alike_whatever_its_suffix_and_branch(self):
        self.assertGreaterEqual(
            name_similarity("Kaveri Ductfab Systems Pvt. Ltd. (Pune)", "KAVERI DUCTFAB SYSTEMS PRIVATE LIMITED"), 0.9
        )

    def test_a_short_name_inside_a_longer_one_reads_alike(self):
        self.assertGreaterEqual(name_similarity("Kaveri", "Kaveri Ductfab Systems"), 0.6)

    def test_two_firms_sharing_only_a_trade_word_do_not(self):
        self.assertLess(name_similarity("Sharma Traders", "Gupta Traders"), 0.6)

    def test_a_typo_still_reads_alike(self):
        self.assertGreaterEqual(name_similarity("Kaveri Ductfab Systems", "Kavery Ductfab Systems"), 0.6)

    def test_a_name_with_nothing_but_suffixes_matches_nothing(self):
        self.assertEqual(name_similarity("Pvt Ltd", "Pvt Ltd"), 0.0)


class TestRankPayees(unittest.TestCase):
    def test_a_payee_whose_linked_vendor_has_the_same_pan_is_a_strong_match_and_comes_first(self):
        ranked = rank_payees(
            "Kaveri Ductfab Systems (Pune)",
            "aahck1234m",
            [
                candidate("PYE-0287", "Kaveri Ductfab Systems", ("Kaveri Ductfab Systems", "ZZZZZ9999Z")),
                candidate("PYE-0412", "KDS Pvt Ltd", ("Kaveri Ductfab Systems (Rohtak)", "AAHCK1234M")),
            ],
        )
        self.assertEqual([(s.payee, s.match) for s in ranked], [("PYE-0412", STRONG), ("PYE-0287", NAME_ONLY)])

    def test_a_same_pan_payee_is_suggested_even_when_its_names_differ(self):
        ranked = rank_payees("Brand New Name", "AAHCK1234M", [candidate("PYE-1", "Old Name", ("Old Name", "AAHCK1234M"))])
        self.assertEqual([(s.payee, s.match) for s in ranked], [("PYE-1", STRONG)])

    def test_a_payee_that_looks_like_nothing_is_left_out(self):
        self.assertEqual(rank_payees("Kaveri Ductfab", "", [candidate("PYE-1", "Sharma Traders")]), [])

    def test_a_blank_pan_never_makes_a_strong_match(self):
        ranked = rank_payees("Kaveri Ductfab", "", [candidate("PYE-1", "Kaveri Ductfab", ("Kaveri Ductfab", ""))])
        self.assertEqual([s.match for s in ranked], [NAME_ONLY])

    def test_a_linked_vendor_name_counts_as_well_as_the_holder_name(self):
        ranked = rank_payees("Kaveri Ductfab", None, [candidate("PYE-1", "R K Gupta", ("Kaveri Ductfab (Gujarat)", None))])
        self.assertEqual([s.payee for s in ranked], ["PYE-1"])

    def test_name_matches_rank_by_how_alike_they_are(self):
        ranked = rank_payees(
            "Kaveri Ductfab Systems",
            None,
            [candidate("PYE-2", "Kaveri Air Systems"), candidate("PYE-1", "Kaveri Ductfab Systems Pvt Ltd")],
        )
        self.assertEqual([s.payee for s in ranked], ["PYE-1", "PYE-2"])

    def test_at_most_limit_suggestions(self):
        many = [candidate(f"PYE-{i}", f"Kaveri Ductfab {i}") for i in range(10)]
        self.assertEqual(len(rank_payees("Kaveri Ductfab", None, many, limit=5)), 5)


if __name__ == "__main__":
    unittest.main()
