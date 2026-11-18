"""SLICE SR-1 (2026-11-17) -- A SUGGEST RUN READS EXACTLY THE SELECTED ROWS, FIRST RUN INCLUDED.

This module used to pin SLICE 12e-5b AC7 (owner R8 "option a", 2026-10-15): a selected-row run ALSO read the rows no run
had read. The owner RETIRED that rule (QR-1 "option a", 2026-11-17 14:33) together with allowing a FIRST run to be a
selected-row run (2026-11-16 10:34 / 2026-11-17 13:09) and the halted-partial carry (QR-2 Q3 (a)). The module keeps its
file name (the parallel-test plan knows it); every 12e-5b test is replaced or INVERTED, named below:

  - test_01 (was: _never_read_rows = population - carry source)       -> _selected_carry_source: live / partial / none
  - test_02 (was: a selected run ALSO reads the never-read rows)      -> INVERTED: it reads ONLY the ticked rows
  - test_03 (was: unchanged when every row was read; whole sheet)     -> the whole-sheet run and the empty echo pinned
  - test_04 (was: the active-run read names the never-read rows)      -> never_read_rows is information only, counted
                                                                         against the run that would be carried, + carry_source
  - test_05 run_is_complete: a selected run completes on ITS OWN rows (recon D4 C4 way 1); whole sheet unchanged
  - test_06 _partial_is_superseded: C5 (pending rows covered) and QR-1 Q1 (a) (it holds every row the partial read)
  - test_07 _open_run_doc: a FIRST selected run starts empty; over a halted partial it carries that partial (Q3 (a))

Every case is driven with the DB, the population and the queue mocked: no AI call, no write, no enqueue.
"""

import json
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
PARTIAL = {"name": "P1", "run_id": "p1", "status": "partial", "committed_version": 3,
           "results": json.dumps([{"excel_row": 10, "a": 1}, {"excel_row": 11, "a": 2}]), "attempted_rows": "[10, 11]"}


class TestSelectedRunsSR1(FrappeTestCase):
    def _pop(self):
        return mock.patch.object(rate_master.extraction, "assemble_population", return_value=(3, POP))

    def test_01_selected_carry_source_live_then_partial_then_none(self):
        """POSITIVE: the live complete run wins; with none, the newest partial at this version (QR-2 Q3 (a)); with
        neither, (None, None) = a FIRST run. NEGATIVE: the partial lookup is not even made when a live run exists."""
        with mock.patch.object(rate_master, "_carry_source_run", return_value=SOURCE_ALL), \
             mock.patch.object(frappe, "get_all") as ga:
            self.assertEqual(rate_master._selected_carry_source("B", "S", 3), ("live", SOURCE_ALL))
            ga.assert_not_called()
        with mock.patch.object(rate_master, "_carry_source_run", return_value=None), \
             mock.patch.object(frappe, "get_all", return_value=[PARTIAL]) as ga:
            self.assertEqual(rate_master._selected_carry_source("B", "S", 3), ("partial", PARTIAL))
            self.assertEqual(ga.call_args.kwargs["filters"]["status"], "partial")
            self.assertEqual(ga.call_args.kwargs["filters"]["committed_version"], 3)
        with mock.patch.object(rate_master, "_carry_source_run", return_value=None), \
             mock.patch.object(frappe, "get_all", return_value=[]):
            self.assertEqual(rate_master._selected_carry_source("B", "S", 3), (None, None))

    def _start(self, only_rows):
        """Drive the REAL start_suggest with its gates passed and the queue captured."""
        enq = mock.MagicMock()
        patches = [
            mock.patch.object(rate_master, "_require_login"),
            mock.patch.object(rate_master, "_resolve_committed_version", return_value=3),
            mock.patch.object(rate_master, "_guard_suggest_gate"),
            mock.patch.object(rate_master, "_guard_only_rows"),
            mock.patch.object(rate_master, "_s_get_marker", return_value=None),
            mock.patch.object(rate_master, "_s_set_marker"),
            mock.patch.object(rate_master, "_carry_source_run", return_value=SOURCE_OLD),
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

    def test_02_INVERTED_a_selected_run_reads_ONLY_the_ticked_rows(self):
        """INVERTS 12e-5b test_02 (owner QR-1 "option a"): ticks 10 + 11 on a sheet whose live run never read 40-42 ->
        the worker gets 10 and 11 ONLY; nothing is added and the echo says so."""
        out, kw = self._start([10, 11])
        self.assertEqual(kw["only_rows"], [10, 11])
        self.assertEqual(out["never_read_added"], [])
        self.assertEqual(out["scoped_row_count"], 2)
        out, kw = self._start([40])
        self.assertEqual((kw["only_rows"], out["never_read_added"]), ([40], []))

    def test_03_whole_sheet_run_unchanged(self):
        """NEGATIVE (the pinned unchanged case): no ticks -> a whole-sheet run, no scope, empty echo."""
        out, kw = self._start(None)
        self.assertEqual((kw["only_rows"], out["never_read_added"], out["scoped_row_count"]), (None, [], None))

    def test_04_never_read_rows_is_information_counted_against_the_carried_run(self):
        """never_read_rows = eligible rows the run a selected pass WOULD carry has not read; carry_source names it.
        live (old) -> 40-42; live (read all) -> none; no live but a partial -> what the partial has not read;
        nothing to carry (a first run) -> every eligible row; no committed version -> nothing, carry_source None."""
        active = {"run_id": "r1", "committed_version": 3, "ai_status": "ok", "results": "[]", "run_at": None, "status": "complete"}

        def read(kind_source, cv=3):
            with mock.patch.object(rate_master, "_require_login"), \
                 mock.patch.object(frappe, "get_all", side_effect=[[dict(active)], []]), \
                 mock.patch.object(rate_master, "_resolve_committed_version", return_value=cv), \
                 mock.patch.object(rate_master, "_selected_carry_source", return_value=kind_source), \
                 mock.patch.object(rate_master.extraction, "assemble_population", return_value=(3, POP)):
                return rate_master.get_active_suggestion_run(boq="B", sheet_name="S")
        out = read(("live", SOURCE_OLD))
        self.assertEqual(out["eligible_rows"], [10, 11, 12, 40, 41, 42])
        self.assertEqual(out["never_read_rows"], [
            {"excel_row": 40, "category_id": "hvac_piping"}, {"excel_row": 41, "category_id": "hvac_piping"},
            {"excel_row": 42, "category_id": "hvac_insulation"}])
        self.assertEqual(out["carry_source"], "live")
        self.assertEqual(read(("live", SOURCE_ALL))["never_read_rows"], [])
        out = read(("partial", PARTIAL))
        self.assertEqual(([r["excel_row"] for r in out["never_read_rows"]], out["carry_source"]), ([12, 40, 41, 42], "partial"))
        out = read((None, None))
        self.assertEqual(([r["excel_row"] for r in out["never_read_rows"]], out["carry_source"]), ([10, 11, 12, 40, 41, 42], None))
        out = read(("live", SOURCE_OLD), cv=None)
        self.assertEqual((out["never_read_rows"], out["carry_source"]), ([], None))

    def test_05_run_is_complete_on_a_selected_runs_own_rows(self):
        """C4 way 1. POSITIVE: a selected pass that attempted all ITS rows completes although other population rows are
        unread (a first selected run). NEGATIVE: one selected row missing -> partial; a halted pass -> partial; a CARRIED
        row cannot complete it (only this pass's own rows count). Whole sheet: the population test, unchanged."""
        pop = {10, 11, 12, 40}
        done = {"complete": True, "attempted_rows": [10, 11]}
        self.assertTrue(rate_master.run_is_complete(done, pop, {10, 11}, {10, 11}))
        self.assertFalse(rate_master.run_is_complete({"complete": True, "attempted_rows": [10]}, pop, {10, 11}, {10, 11}))
        self.assertFalse(rate_master.run_is_complete(dict(done, complete=False), pop, {10, 11}, {10, 11}))
        # row 11 is in the document (carried) but THIS pass did not attempt it -> not complete
        self.assertFalse(rate_master.run_is_complete({"complete": True, "attempted_rows": [10]}, pop, {10, 11, 12}, {10, 11}))
        # whole sheet: every population row attempted, else partial
        self.assertTrue(rate_master.run_is_complete({"complete": True, "attempted_rows": [10]}, pop, pop, None))
        self.assertFalse(rate_master.run_is_complete({"complete": True}, pop, {10, 11, 12}, None))
        # an older envelope without the pass's rows keeps the pre-SR-1 population test
        self.assertTrue(rate_master.run_is_complete({"complete": True}, pop, pop, {10}))
        self.assertFalse(rate_master.run_is_complete({"complete": True}, pop, {10}, {10}))

    def test_06_partial_is_superseded_C5_and_Q1a(self):
        """POSITIVE (C5): a newer complete run that attempted every row the partial still had pending. POSITIVE (QR-1
        Q1 (a)): a newer complete run that HOLDS every row the partial read (it carried them). NEGATIVE: a newer selected
        run that neither covers the pending rows nor holds the partial's rows keeps the Resume strip. No newer run ->
        False. No partial passed -> the pre-SR-1 rule (any newer complete run)."""
        part = {"attempted_rows": "[10, 11]", "scope_rows": None}  # a whole-sheet partial: pending = pop - read = 12, 40

        def sup(newer_attempted, partial=part):
            rows = [{"attempted_rows": json.dumps(a)} for a in newer_attempted]
            with mock.patch.object(frappe, "get_all", return_value=rows), \
                 mock.patch.object(rate_master, "_population_rows", return_value={10, 11, 12, 40}):
                return rate_master._partial_is_superseded("B", "S", 3, "2026-11-17 10:00:00", partial=partial)
        self.assertTrue(sup([[12, 40]]))                 # C5: covers the pending rows
        self.assertTrue(sup([[10, 11, 40]]))             # Q1 (a): holds every row the partial read
        self.assertFalse(sup([[40]]))                    # neither -> the Resume strip stays
        self.assertFalse(sup([]))                        # no newer complete run
        # a SCOPED partial: pending = its stored scope_rows, not the population
        self.assertTrue(sup([[41]], partial={"attempted_rows": "[10]", "scope_rows": "[41]"}))
        self.assertFalse(sup([[42]], partial={"attempted_rows": "[10]", "scope_rows": "[41]"}))
        with mock.patch.object(frappe, "get_all", return_value=[{"attempted_rows": "[40]"}]):
            self.assertTrue(rate_master._partial_is_superseded("B", "S", 3, "2026-11-17 10:00:00"))

    def _open(self, kind_source):
        doc = mock.MagicMock()
        doc.name = "NEW"
        with mock.patch.object(rate_master, "_selected_carry_source", return_value=kind_source), \
             mock.patch.object(frappe, "new_doc", return_value=doc), \
             mock.patch.object(frappe.db, "commit"):
            out = rate_master._open_run_doc("B", "S", 3, "job1", "u@x", None, only_rows=[40, 41])
        return out, doc

    def test_07_open_run_doc_first_run_starts_empty_and_Q3_carries_the_partial(self):
        """POSITIVE: a FIRST selected run (nothing to carry) starts EMPTY, scope = the selection, persisted. QR-2 Q3 (a):
        with only a halted partial, the new run carries that partial's rows byte-identically."""
        (name, run_id, carried, attempted, scope), doc = self._open((None, None))
        self.assertEqual((carried, attempted, scope), ([], [], {40, 41}))
        self.assertEqual((doc.results, doc.attempted_rows, doc.scope_rows, doc.active), ("[]", "[]", "[40, 41]", 0))
        (name, run_id, carried, attempted, scope), doc = self._open(("partial", PARTIAL))
        self.assertEqual(attempted, [10, 11])
        self.assertEqual(doc.results, rate_master.serialize_run_results(json.loads(PARTIAL["results"])))
        self.assertEqual(scope, {40, 41})
