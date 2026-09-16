# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for `ledgers.py` -- the one owner of the settleable-status rule (slice V1, #1289).

The rule is one line of data, which is exactly why it needs tests: it is small enough to look
harmless and central enough that widening it by one word lets this import pay something nobody
approved. `candidates.py` (what may be OFFERED) and `settle.py` (what may be WRITTEN) both read the
same map, and these tests pin the properties that make sharing it worth doing.

⚠️ THE ANCHOR MOVED FROM `Approved` TO `Reconciliation Pending` AT #1289, and these tests were
INVERTED rather than deleted. The payment and expense lifecycle gained a step after `Approved`
(#1282): an Accountant presses **Mark as Done** when the money has gone out, and only THEN is the
record waiting for its bank line. The old pins are kept here, saying the opposite of what they said,
so a revert to the `Approved` anchor fails loudly instead of silently re-opening the double-recording
hole this change closed.
"""

import unittest

from nirmaan_stack.services.outflow_import import candidates as C
from nirmaan_stack.services.outflow_import import settle as S
from nirmaan_stack.services.outflow_import.ledgers import (
    APPROVED,
    EXPENSE_DOCTYPES,
    LEDGER_DOCTYPES,
    NON_PROJECT_EXPENSE_DOCTYPE,
    PAID,
    PAYMENT_DOCTYPE,
    PROJECT_EXPENSE_DOCTYPE,
    RECONCILIATION_PENDING,
    SETTLEABLE_STATUSES,
    is_expense_doctype,
    settleable_statuses,
)


class TestTheReconciliationPendingOnlyRule(unittest.TestCase):
    def test_every_ledger_settles_from_reconciliation_pending_and_only_that(self):
        """#1289: Reconciliation Pending only, all three ledgers, no exception."""
        self.assertEqual(set(SETTLEABLE_STATUSES), set(LEDGER_DOCTYPES))
        for doctype in LEDGER_DOCTYPES:
            self.assertEqual(settleable_statuses(doctype), (RECONCILIATION_PENDING,))

    def test_approved_is_settleable_from_nowhere_any_more(self):
        """⚠️ THE INVERSION OF THE ORIGINAL RULE, KEPT AS A TEST RATHER THAN DELETED.

        `Approved` means sanctioned, not sent. A line that settled an `Approved` record would mark
        money Paid that nobody has confirmed left the bank -- and, worse, a record an Accountant HAD
        marked done would find no line, sit unmatched, and be recorded a second time by Create.
        """
        for doctype in LEDGER_DOCTYPES:
            self.assertNotIn(APPROVED, settleable_statuses(doctype))

    def test_the_non_project_requested_exception_is_gone(self):
        """v2 accepted `Requested` on Non Project Expenses, reasoning that the doctype has no
        separate approval step in practice so an Approved-only pool would be empty. The owner
        overruled it: an empty pool is the correct answer when nothing is approved."""
        self.assertNotIn("Requested", settleable_statuses(NON_PROJECT_EXPENSE_DOCTYPE))

    def test_paid_is_settleable_from_nowhere(self):
        """⚠️ THE ONE THAT MATTERS MOST. A `Paid` record is a DUPLICATE FINDING, handled by a
        separate query and turned into a Skip. If `Paid` ever appears in this map, the import
        becomes able to re-pay money that has already left the bank."""
        for doctype in LEDGER_DOCTYPES:
            self.assertNotIn(PAID, settleable_statuses(doctype))

    def test_an_unknown_doctype_settles_from_nothing_rather_than_raising(self):
        """A caller that forgets to check gets 'nothing is settleable', not a KeyError inside a
        write path."""
        self.assertEqual(settleable_statuses("Sales Invoice"), ())
        self.assertEqual(settleable_statuses(""), ())


class TestWhatMayBeCreated(unittest.TestCase):
    def test_only_the_two_expense_doctypes_may_be_created(self):
        self.assertEqual(set(EXPENSE_DOCTYPES), {PROJECT_EXPENSE_DOCTYPE, NON_PROJECT_EXPENSE_DOCTYPE})

    def test_a_project_payment_may_be_settled_but_never_created(self):
        """Half the v3 spine: a Project Payment is born from a PO or SR request, and the import
        must never mint one. It IS settleable -- that is the other half."""
        self.assertIn(PAYMENT_DOCTYPE, LEDGER_DOCTYPES)
        self.assertFalse(is_expense_doctype(PAYMENT_DOCTYPE))
        self.assertTrue(settleable_statuses(PAYMENT_DOCTYPE))


class TestThereIsExactlyOneCopy(unittest.TestCase):
    """The point of the module. Two copies of this rule is how one gets tightened and the other
    does not -- and the failure is silent in both directions: the screen offers a record the write
    path refuses, or refuses one it would have paid."""

    def test_settle_reads_the_shared_map_rather_than_its_own(self):
        self.assertIs(S.SETTLEABLE_STATUSES, SETTLEABLE_STATUSES)

    def test_candidates_reads_the_shared_map_rather_than_its_own(self):
        self.assertEqual(C._PAYMENT_STATUSES, settleable_statuses(PAYMENT_DOCTYPE))
        self.assertEqual(C._PROJECT_EXPENSE_STATUSES, settleable_statuses(PROJECT_EXPENSE_DOCTYPE))
        self.assertEqual(
            C._NON_PROJECT_EXPENSE_STATUSES, settleable_statuses(NON_PROJECT_EXPENSE_DOCTYPE)
        )

    def test_neither_module_redefines_the_statuses_as_a_literal(self):
        """Source-level, deliberately. The assertions above compare VALUES, and two literals that
        happen to agree today would satisfy them -- which is the exact state V1 was written to end.
        """
        import inspect

        for module in (C, S):
            source = inspect.getsource(module)
            body = "\n".join(
                line
                for line in source.splitlines()
                if not line.lstrip().startswith("#")
            )
            self.assertNotIn('"Approved", "Requested"', body, module.__name__)
            self.assertNotIn("'Approved', 'Requested'", body, module.__name__)

    def test_no_write_path_spells_the_settleable_status_for_itself(self):
        """⚠️ THE GUARD ABOVE WENT BLUNT WHEN THE ANCHOR MOVED (#1289), AND THIS IS THE REPLACEMENT.

        It hunted for the ONE v2 pair of literals, so it saw nothing when three modules each kept a
        private `_APPROVED = "Approved"` -- and when `SETTLEABLE_STATUSES` moved to
        `Reconciliation Pending`, those three copies were what made the part settle refuse itself:
        `split_payment` was told to expect `Approved` on a payment the map had just made settleable
        at another status. A value comparison could never have caught it, because the copies did not
        disagree until the day the map changed.

        So this asks the honest question of the four modules on the write path: does the source
        SPELL a settleable status at all? Every one of them reads `settleable_statuses` now.
        Comments are stripped -- they must stay free to name the statuses, and this note does.
        """
        import inspect

        from nirmaan_stack.api.outflow_import import expenses as E
        from nirmaan_stack.api.outflow_import import unreconcile_split as US
        from nirmaan_stack.services.outflow_import import unsplit as U

        settleable = set(SETTLEABLE_STATUSES[PAYMENT_DOCTYPE])
        for module in (C, S, E, U, US):
            body = "\n".join(
                line
                for line in inspect.getsource(module).splitlines()
                if not line.lstrip().startswith("#")
            )
            for status in settleable:
                self.assertNotIn(f'"{status}"', body, module.__name__)
                self.assertNotIn(f"'{status}'", body, module.__name__)


class TestTheModuleStaysPure(unittest.TestCase):
    def test_it_imports_neither_frappe_nor_anything_from_this_package(self):
        """It holds vocabulary, not behaviour. Both a pure deriver and a DB-touching reader import
        it, so a dependency here would propagate into places that must stay testable without a
        bench."""
        import inspect

        from nirmaan_stack.services.outflow_import import ledgers

        for line in inspect.getsource(ledgers).splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                self.assertNotIn("frappe", stripped)
                self.assertNotIn("nirmaan_stack", stripped)


if __name__ == "__main__":
    unittest.main()
