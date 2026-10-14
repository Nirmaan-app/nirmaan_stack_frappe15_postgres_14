"""SLICE 12e-5b AC7 (owner R8, "option a", 2026-10-15) -- A SELECTED-ROW RUN ALSO READS THE ROWS NO RUN HAS READ.

12e-5 found it on BOQ-26-00231: the sheet's active run was complete, but 42 rows had become eligible since (their
category gained a rate config), so no run had ever attempted them. A selected-row pass carries the active run's
rows forward and completes only when the population minus everything attempted is empty -- so it ended "partial"
on rows nobody had picked, with a Resume strip the owner never asked for. Owner ruling (a): the pass reads those
rows too, and the confirmation says so first and counts them.

  - `_never_read_rows` is today's population minus what the carry-source run attempted, with each row's category;
  - `start_suggest` adds them to a selected-row run's rows (never to a whole-sheet run, which reads everything);
  - `get_active_suggestion_run` names them (`never_read_rows`), so the confirmation can count them.

Every case is driven with the DB, the population and the queue mocked: no AI call, no write, no enqueue.
"""

from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq import rate_master

POP = [  # today's population: (excel_row, category_id)
    {"excel_row": 10, "category_id": "hvac_piping"},
    {"excel_row": 11, "category_id": "hvac_piping"},
    {"excel_row": 12, "category_id": "hvac_insulation"},
    {"excel_row": 40, "category_id": "hvac_piping"},
    {"excel_row": 41, "category_id": "hvac_piping"},
    {"excel_row": 42, "category_id": "hvac_insulation"},
]
SOURCE_ALL = {"name": "R1", "run_id": "r1", "status": "complete", "committed_version": 3, "results": "[]",
              "attempted_rows": "[10, 11, 12, 40, 41, 42]"}
SOURCE_OLD = dict(SOURCE_ALL, attempted_rows="[10, 11, 12]")  # complete BEFORE rows 40-42 became eligible


class TestNeverReadRows12e5b(FrappeTestCase):
    def _pop(self):
        return mock.patch.object(rate_master.extraction, "assemble_population", return_value=(3, POP))

    def test_01_never_read_is_the_population_minus_what_the_carry_source_attempted(self):
        """POSITIVE: rows 40-42 became eligible after the source run -- named with their categories.
        NEGATIVE: a source that read every row -> nothing; no carry source -> nothing (and no population read)."""
        with self._pop(), mock.patch.object(rate_master, "_carry_source_run", return_value=SOURCE_OLD):
            self.assertEqual(rate_master._never_read_rows("B", "S", 3),
                             {40: "hvac_piping", 41: "hvac_piping", 42: "hvac_insulation"})
        with self._pop(), mock.patch.object(rate_master, "_carry_source_run", return_value=SOURCE_ALL):
            self.assertEqual(rate_master._never_read_rows("B", "S", 3), {})
        with self._pop() as pop, mock.patch.object(rate_master, "_carry_source_run", return_value=None):
            self.assertEqual(rate_master._never_read_rows("B", "S", 3), {})
            pop.assert_not_called()

    def _start(self, source, only_rows):
        """Drive the REAL start_suggest with its gates passed and the queue captured."""
        enq = mock.MagicMock()
        patches = [
            mock.patch.object(rate_master, "_require_login"),
            mock.patch.object(rate_master, "_resolve_committed_version", return_value=3),
            mock.patch.object(rate_master, "_guard_suggest_gate"),
            mock.patch.object(rate_master, "_guard_only_rows"),
            mock.patch.object(rate_master, "_s_get_marker", return_value=None),
            mock.patch.object(rate_master, "_s_set_marker"),
            mock.patch.object(rate_master, "_carry_source_run", return_value=source),
            mock.patch.object(rate_master.extraction, "assemble_population", return_value=(3, POP)),
            mock.patch.object(frappe.db, "exists", return_value=True),
            mock.patch.object(frappe.db, "commit"),
            mock.patch.object(frappe, "enqueue", enq),
        ]
        for p in patches:
            p.start()
        try:
            out = rate_master.start_suggest(boq="B", sheet_name="S", only_rows=only_rows)
        finally:
            for p in reversed(patches):
                p.stop()
        return out, enq.call_args.kwargs

    def test_02_a_selected_row_run_also_reads_the_never_read_rows(self):
        """POSITIVE: ticks 10 + 11 on a sheet whose source never read 40-42 -> the worker gets 10, 11, 40, 41, 42 (the
        ticked rows are never duplicated), and the response names what was added. The worker then completes: the
        population minus (carried attempted + this scope) is empty -- the 00231 partial cannot recur."""
        out, kw = self._start(SOURCE_OLD, [10, 11])
        self.assertEqual(kw["only_rows"], [10, 11, 40, 41, 42])
        self.assertEqual(out["never_read_added"], [40, 41, 42])
        self.assertEqual(out["scoped_row_count"], 5)
        carried = {10, 11, 12}
        self.assertEqual({r["excel_row"] for r in POP} - (carried | set(kw["only_rows"])), set())
        # a ticked never-read row is counted once
        out, kw = self._start(SOURCE_OLD, [40])
        self.assertEqual((kw["only_rows"], out["never_read_added"]), ([40, 41, 42], [41, 42]))

    def test_03_unchanged_when_every_row_was_read_and_on_a_whole_sheet_run(self):
        """NEGATIVE (the pinned unchanged case): a source that read every row -> exactly the ticked rows, nothing
        added. A whole-sheet run (no ticks) is untouched: no rows named, no never-read lookup at all."""
        out, kw = self._start(SOURCE_ALL, [10, 11])
        self.assertEqual((kw["only_rows"], out["never_read_added"], out["scoped_row_count"]), ([10, 11], [], 2))
        with mock.patch.object(rate_master, "_never_read_rows") as nr:
            out, kw = self._start(SOURCE_OLD, None)
            nr.assert_not_called()
        self.assertEqual((kw["only_rows"], out["never_read_added"], out["scoped_row_count"]), (None, [], None))

    def test_04_the_active_run_read_names_the_never_read_rows_with_their_categories(self):
        """POSITIVE: `never_read_rows` lists 40-42 with categories beside `eligible_rows`. NEGATIVE: none when the
        source read every row, and none when the sheet has no committed version."""
        active = {"run_id": "r1", "committed_version": 3, "ai_status": "ok", "results": "[]", "run_at": None, "status": "complete"}

        def read(source, cv=3, run=active):
            with mock.patch.object(rate_master, "_require_login"), \
                 mock.patch.object(frappe, "get_all", side_effect=[[dict(run)] if run else [], []]), \
                 mock.patch.object(rate_master, "_resolve_committed_version", return_value=cv), \
                 mock.patch.object(rate_master, "_carry_source_run", return_value=source), \
                 mock.patch.object(rate_master.extraction, "assemble_population", return_value=(3, POP)):
                return rate_master.get_active_suggestion_run(boq="B", sheet_name="S")
        out = read(SOURCE_OLD)
        self.assertEqual(out["eligible_rows"], [10, 11, 12, 40, 41, 42])
        self.assertEqual(out["never_read_rows"], [
            {"excel_row": 40, "category_id": "hvac_piping"}, {"excel_row": 41, "category_id": "hvac_piping"},
            {"excel_row": 42, "category_id": "hvac_insulation"}])
        self.assertEqual(read(SOURCE_ALL)["never_read_rows"], [])
        self.assertEqual(read(SOURCE_OLD, cv=None)["never_read_rows"], [])
        # ... and none when there is no active run, or it is partial, or on an older committed version
        self.assertEqual(read(SOURCE_OLD, run=None)["never_read_rows"], [])
        self.assertEqual(read(SOURCE_OLD, run=dict(active, status="partial"))["never_read_rows"], [])
        self.assertEqual(read(SOURCE_OLD, run=dict(active, committed_version=2))["never_read_rows"], [])
