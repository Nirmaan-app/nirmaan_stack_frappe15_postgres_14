# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for services/boq_ai_guidance.py (slice S1b) -- the examples library and the
candidate-parent shortlist behind the guided Claude prompt.

NO test here makes an AI call, builds the library from the real site data, or writes the
site's real library file: the build's reads are FAKED, and every file lives in a temp dir.

  TestShortlistRuleV4     the six candidate slots, their order, the cap, the spacer skip
  TestExamplesLibrary     similarity ranking, the two bonuses, exclusion, blank rows
  TestGuidanceForRows     the per-row shape the prompt receives (positive + negative)
  TestLibraryFile         save / load, the 24 h rule, the corrupt-file path
  TestRebuildLock         two runs at once -> ONE build; a wait that times out raises
  TestBuildGuidance       exclusions at look-up; a library failure -> no examples, logged
  TestRevisionFamily      the source_boq chain, both directions
  TestBuildLibraryRule    the truth rule + "never a rate / amount column", on faked reads
"""
import hashlib
import json
import os
import pickle
import shutil
import tempfile
import threading
import time
import unittest
from unittest import mock

import frappe
from filelock import FileLock, Timeout

from nirmaan_stack.services import boq_ai_guidance as G
from nirmaan_stack.services.boq_ai_guidance import (
    ExamplesLibrary,
    build_guidance,
    get_library,
    guidance_for_rows,
    is_fresh,
    load_library,
    revision_family,
    save_library,
    shortlist,
    sl_prefix,
    sl_shape,
)


def _lib_row(boq, description, truth_type, sl_no="", unit="", has_qty=False, sheet="S"):
    return {"boq": boq, "sheet": sheet, "excel_row": 1, "sl_no": sl_no,
            "description": description, "unit": unit, "has_qty": has_qty,
            "truth_type": truth_type}


def _small_library(testproject=()):
    return ExamplesLibrary([
        _lib_row("BOQ-A", "Supply of 2 core copper cable", "line_item", "1.1", "m", True),
        _lib_row("BOQ-A", "ELECTRICAL WORKS", "preamble", "A"),
        _lib_row("BOQ-B", "Supply of 2 core copper cable", "line_item", "2.1", "m", True),
        _lib_row("BOQ-B", "All materials shall be as per standards", "note"),
        _lib_row("BOQ-C", "Supply of 4 core copper cable", "line_item", "3", "m", True),
        _lib_row("BOQ-C", "", "spacer"),
        _lib_row("BOQ-T", "Supply of 2 core copper cable", "preamble", "9"),
    ], testproject)


def _review_row(idx, excel, cls, parent=-1, sl=None, desc="", unit=None, qty=None, **extra):
    row = {"row_index": idx, "source_row_number": excel, "classification": cls,
           "parent_index": parent, "sl_no_value": sl, "description": desc, "unit": unit,
           "qty_total": qty, "qty_by_area": None}
    row.update(extra)
    return row


class TestShortlistRuleV4(unittest.TestCase):

    def _rows(self):
        # excel: 2 preamble "A", 3 preamble "1", 4 spacer, 5 heading-like note,
        #        6 line_item "1.1", 7 long note, 8 line_item "1.2"
        rows = [
            {"excel_row": 2, "sl_no": "A", "description": "ELECTRICAL", "unit": ""},
            {"excel_row": 3, "sl_no": "1", "description": "LT CABLES", "unit": ""},
            {"excel_row": 4, "sl_no": "", "description": "", "unit": ""},
            {"excel_row": 5, "sl_no": "", "description": "Armoured cables", "unit": ""},
            {"excel_row": 6, "sl_no": "1.1", "description": "2 core cable", "unit": "m"},
            {"excel_row": 7, "sl_no": "", "description": "x" * 61, "unit": ""},
            {"excel_row": 8, "sl_no": "1.2", "description": "4 core cable", "unit": "m"},
        ]
        ptype = {2: "preamble", 3: "preamble", 4: "spacer", 5: "note", 6: "line_item",
                 7: "note", 8: "line_item"}
        return rows, ptype

    def test_slots_in_order_parser_parent_first(self):
        rows, ptype = self._rows()
        # row 8: parser parent = 6; serial prefix "1" -> row 3; preambles 3 then 2;
        # heading-like note = 5 (row 7 is too long); lettered serial = 2 (already in).
        out = shortlist(rows, 6, ptype.get, {8: 6}.get)
        self.assertEqual(out, [6, 3, 2, 5])

    def test_no_parser_parent_starts_with_the_serial_parent(self):
        rows, ptype = self._rows()
        self.assertEqual(shortlist(rows, 4, ptype.get, lambda e: None), [3, 2, 5])

    def test_a_parser_spacer_is_never_a_candidate(self):
        rows, ptype = self._rows()
        for i in range(len(rows)):
            self.assertNotIn(4, shortlist(rows, i, ptype.get, lambda e: None))

    def test_only_earlier_rows_and_the_first_row_has_none(self):
        rows, ptype = self._rows()
        self.assertEqual(shortlist(rows, 0, ptype.get, lambda e: None), [])
        for i, r in enumerate(rows):
            for c in shortlist(rows, i, ptype.get, lambda e: None):
                self.assertLess(c, r["excel_row"])

    def test_capped_at_five_and_de_duplicated(self):
        rows = [{"excel_row": n, "sl_no": s, "description": d, "unit": ""} for n, s, d in [
            (2, "B", "SECTION B"), (3, "7", "SUB"), (4, "", "Heading note"),
            (5, "c", "lettered"), (6, "9", "another"), (7, "7.1", "item"),
        ]]
        ptype = {2: "preamble", 3: "preamble", 4: "note", 5: "line_item", 6: "line_item",
                 7: "line_item"}
        out = shortlist(rows, 5, ptype.get, {7: 6}.get)
        self.assertEqual(out, [6, 3, 2, 4, 5])
        self.assertEqual(len(out), len(set(out)))
        self.assertLessEqual(len(out), 5)

    def test_serial_helpers(self):
        self.assertEqual(sl_prefix("1.01"), "1")
        self.assertEqual(sl_prefix("2.3.4"), "2.3")
        self.assertEqual(sl_prefix("A.1"), "a")
        self.assertIsNone(sl_prefix("12"))
        self.assertEqual([sl_shape(s) for s in ("", "28.0", "1.2", "B)", "iv", "a1", "x y")],
                         ["blank", "int", "dotted", "alpha", "roman", "alnum", "other"])


class TestExamplesLibrary(unittest.TestCase):

    def test_best_match_first_and_at_most_five(self):
        lib = _small_library()
        out = lib.top5({"description": "Supply of 2 core copper cable", "sl_no": "4.1",
                        "has_qty": True})
        self.assertLessEqual(len(out), 5)
        self.assertEqual(out[0]["correct_row_type"], "line_item")
        self.assertEqual(out[0]["description"], "Supply of 2 core copper cable")
        self.assertEqual([e["score"] for e in out], sorted((e["score"] for e in out), reverse=True))

    def test_has_qty_and_serial_shape_bonuses_break_a_text_tie(self):
        # Three library rows share the query's text exactly (BOQ-A, BOQ-B: has_qty + dotted;
        # BOQ-T: no qty, int serial). A no-qty, int-serial query must rank BOQ-T first.
        lib = _small_library()
        out = lib.top5({"description": "Supply of 2 core copper cable", "sl_no": "5",
                        "has_qty": False})
        self.assertEqual(out[0]["boq"], "BOQ-T")
        self.assertAlmostEqual(out[0]["score"] - out[1]["score"], 0.25, places=3)

    def test_excluded_boqs_never_appear(self):
        lib = _small_library()
        query = {"description": "Supply of 2 core copper cable", "sl_no": "1.1", "has_qty": True}
        self.assertIn("BOQ-A", {e["boq"] for e in lib.top5(query)})
        out = lib.top5(query, exclude=frozenset({"BOQ-A", "BOQ-T"}))
        self.assertTrue(out)
        self.assertFalse({"BOQ-A", "BOQ-T"} & {e["boq"] for e in out})

    def test_a_blank_row_is_matched_against_blank_rows(self):
        lib = _small_library()
        out = lib.top5({"description": "", "sl_no": "", "has_qty": False})
        self.assertEqual([e["correct_row_type"] for e in out], ["spacer"])

    def test_state_round_trip_gives_identical_answers(self):
        lib = _small_library(testproject=["BOQ-T"])
        again = ExamplesLibrary.from_state(pickle.loads(pickle.dumps(lib.state(), protocol=5)))
        query = {"description": "4 core copper cable supply", "sl_no": "2", "has_qty": True}
        self.assertEqual(lib.top5(query), again.top5(query))
        self.assertEqual(again.testproject, frozenset({"BOQ-T"}))

    def test_unknown_file_format_is_refused(self):
        with self.assertRaises(ValueError):
            ExamplesLibrary.from_state({"format": 999})


class TestGuidanceForRows(unittest.TestCase):

    def _rows(self):
        return [
            _review_row(0, 2, "preamble", sl="A", desc="ELECTRICAL WORKS"),
            _review_row(1, 3, "line_item", parent=0, sl="1.1",
                        desc="Supply of 2 core copper cable", unit="m", qty=12.5),
            _review_row(2, 4, "line_item", parent=1, sl="1.2", desc="D" * 200, unit="m"),
        ]

    def test_shape_per_row(self):
        g = guidance_for_rows(self._rows(), _small_library())
        self.assertEqual(sorted(g), [2, 3, 4])
        for entry in g.values():
            self.assertEqual(list(entry), ["similar_reviewed_rows", "candidate_parents"])
            self.assertEqual(entry["candidate_parents"][-1], "none (top level)")
            for e in entry["similar_reviewed_rows"]:
                self.assertEqual(
                    list(e), ["sl_no", "description", "unit", "has_qty", "correct_row_type"])
                self.assertIsInstance(e["has_qty"], bool)

    def test_candidate_parent_text_and_parser_parent_first(self):
        g = guidance_for_rows(self._rows(), None)
        self.assertEqual(g[3]["candidate_parents"],
                         ["row 2 | sl A | ELECTRICAL WORKS", "none (top level)"])
        self.assertEqual(g[4]["candidate_parents"][0],
                         "row 3 | sl 1.1 | Supply of 2 core copper cable")

    def test_candidate_description_is_cut_at_120(self):
        rows = self._rows() + [_review_row(3, 5, "line_item", parent=2, sl="1.3", desc="x")]
        first = guidance_for_rows(rows, None)[5]["candidate_parents"][0]
        self.assertEqual(first, "row 4 | sl 1.2 | " + "D" * 120)

    def test_shortlist_reads_the_parser_values_not_the_effective_ones(self):
        # A human re-parented row 4 to the preamble and re-labelled the preamble a note.
        rows = self._rows()
        rows[2].update({"effective_parent_index": 0, "human_parent": 0})
        rows[0].update({"effective_classification": "note", "human_classification": "note"})
        g = guidance_for_rows(rows, None)
        self.assertEqual(g[4]["candidate_parents"][0].split(" | ")[0], "row 3",
                         "the PARSER's parent (row 3) is listed first, not the human's (row 2)")
        self.assertIn("row 2 | sl A | ELECTRICAL WORKS", g[4]["candidate_parents"],
                      "row 2 is still offered as the nearest PARSER preamble")

    def test_no_library_means_no_examples_but_candidates_stay(self):
        g = guidance_for_rows(self._rows(), None)
        self.assertTrue(all(e["similar_reviewed_rows"] == [] for e in g.values()))
        self.assertTrue(all(e["candidate_parents"] for e in g.values()))

    def test_examples_never_carry_source_boq_score_or_a_number(self):
        """NEGATIVE: an example names no BoQ, sheet or score, and no quantity value."""
        rows = [_review_row(0, 2, "line_item", sl="1.1", desc="Supply of 2 core copper cable",
                            unit="m", qty=98765.4321, rate=11111.5, amount=22222.5)]
        g = guidance_for_rows(rows, _small_library())
        text = repr(g)
        for leak in ("BOQ-A", "BOQ-B", "score", "98765", "11111", "22222", "'sheet'"):
            self.assertNotIn(leak, text)

    def test_example_description_is_cut_at_120(self):
        lib = ExamplesLibrary([_lib_row("BOQ-A", "cable " * 60, "line_item")])
        g = guidance_for_rows([_review_row(0, 2, "line_item", desc="cable cable")], lib)
        self.assertEqual(len(g[2]["similar_reviewed_rows"][0]["description"]), 120)

    def test_exclusion_is_applied(self):
        g = guidance_for_rows(self._rows(), _small_library(),
                              exclude=frozenset({"BOQ-A", "BOQ-B", "BOQ-C", "BOQ-T"}))
        self.assertTrue(all(e["similar_reviewed_rows"] == [] for e in g.values()))


class _TempDirCase(unittest.TestCase):

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="boq_ai_lib_test_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.path = os.path.join(self.dir, "sub", "examples_library.pkl")

    def _age(self, hours):
        t = time.time() - hours * 3600
        os.utime(self.path, (t, t))


class TestLibraryFile(_TempDirCase):

    def test_save_then_load_round_trip_and_no_temp_file_left(self):
        save_library(_small_library(["BOQ-T"]), self.path)
        self.assertEqual(os.listdir(os.path.dirname(self.path)), ["examples_library.pkl"])
        lib = load_library(self.path)
        self.assertEqual(lib.N, 7)
        self.assertEqual(lib.testproject, frozenset({"BOQ-T"}))

    def test_the_24_hour_rule(self):
        self.assertFalse(is_fresh(self.path), "a missing file is not fresh")
        save_library(_small_library(), self.path)
        self.assertTrue(is_fresh(self.path))
        self._age(23.9)
        self.assertTrue(is_fresh(self.path), "23.9 h old is still fresh")
        self._age(24.1)
        self.assertFalse(is_fresh(self.path), "24.1 h old is stale")

    def test_fresh_file_is_loaded_without_a_build(self):
        save_library(_small_library(), self.path)
        with mock.patch.object(G, "build_library") as build:
            lib, rebuilt = get_library(self.path)
        self.assertFalse(build.called)
        self.assertFalse(rebuilt)
        self.assertEqual(lib.N, 7)

    def test_missing_file_is_built_and_saved(self):
        with mock.patch.object(G, "build_library", return_value=_small_library()) as build:
            lib, rebuilt = get_library(self.path)
        self.assertEqual(build.call_count, 1)
        self.assertTrue(rebuilt)
        self.assertTrue(is_fresh(self.path))
        self.assertEqual(load_library(self.path).N, lib.N)

    def test_stale_file_is_rebuilt_and_replaced(self):
        save_library(ExamplesLibrary([_lib_row("OLD", "old row", "note")]), self.path)
        self._age(25)
        with mock.patch.object(G, "build_library", return_value=_small_library()) as build:
            lib, rebuilt = get_library(self.path)
        self.assertEqual(build.call_count, 1)
        self.assertTrue(rebuilt)
        self.assertEqual(lib.N, 7)
        self.assertEqual(load_library(self.path).N, 7, "the stale file was replaced")

    def test_unreadable_fresh_file_is_rebuilt(self):
        os.makedirs(os.path.dirname(self.path))
        with open(self.path, "wb") as f:
            f.write(b"not a pickle")
        with mock.patch.object(G, "build_library", return_value=_small_library()) as build:
            lib, rebuilt = get_library(self.path)
        self.assertEqual(build.call_count, 1)
        self.assertTrue(rebuilt)

    def test_failed_build_raises_and_leaves_no_file(self):
        with mock.patch.object(G, "build_library", side_effect=RuntimeError("db down")):
            with self.assertRaises(RuntimeError):
                get_library(self.path)
        self.assertFalse(os.path.exists(self.path))


class TestRebuildLock(_TempDirCase):

    def test_two_runs_at_once_make_one_build(self):
        calls = []

        def slow_build():
            calls.append(threading.get_ident())
            time.sleep(0.6)
            return _small_library()

        results, errors = [], []

        def run():
            try:
                results.append(get_library(self.path))
            except Exception as exc:    # surfaced by the assertions below
                errors.append(exc)

        with mock.patch.object(G, "build_library", side_effect=slow_build):
            threads = [threading.Thread(target=run) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(30)
        self.assertEqual(errors, [])
        self.assertEqual(len(calls), 1, "the second run must wait and reuse the first build")
        self.assertEqual(sorted(rebuilt for _lib, rebuilt in results), [False, True])
        self.assertEqual([lib.N for lib, _rebuilt in results], [7, 7])

    def test_a_wait_longer_than_the_limit_raises(self):
        os.makedirs(os.path.dirname(self.path))
        holder = FileLock(self.path + ".lock")
        holder.acquire()
        self.addCleanup(holder.release)
        with mock.patch.object(G, "REBUILD_WAIT_SEC", 0.3), \
             mock.patch.object(G, "build_library") as build:
            with self.assertRaises(Timeout):
                get_library(self.path)
        self.assertFalse(build.called, "a run that could not get the lock must not build")

    def test_the_wait_limit_is_three_minutes(self):
        self.assertEqual(G.REBUILD_WAIT_SEC, 180)
        self.assertEqual(G.LIBRARY_MAX_AGE_SEC, 24 * 3600)


class TestBuildGuidance(unittest.TestCase):

    def _rows(self):
        return [
            _review_row(0, 2, "preamble", sl="A", desc="ELECTRICAL WORKS"),
            _review_row(1, 3, "line_item", parent=0, sl="1.1",
                        desc="Supply of 2 core copper cable", unit="m", qty=3),
        ]

    def test_family_and_testproject_boqs_are_excluded(self):
        lib = _small_library(testproject=["BOQ-T"])
        with mock.patch.object(G, "get_library", return_value=(lib, False)), \
             mock.patch.object(G, "revision_family", return_value=frozenset({"BOQ-A", "BOQ-B"})):
            g = build_guidance("BOQ-A", self._rows())
        # Only BOQ-C is left for the cable row.
        self.assertEqual([e["description"] for e in g[3]["similar_reviewed_rows"]],
                         ["Supply of 4 core copper cable"])

    def test_without_exclusions_the_same_row_sees_the_other_boqs(self):
        """The vacuity partner of the test above: the exclusion is what removed them."""
        lib = _small_library()
        with mock.patch.object(G, "get_library", return_value=(lib, False)), \
             mock.patch.object(G, "revision_family", return_value=frozenset()):
            g = build_guidance("BOQ-X", self._rows())
        descriptions = [e["description"] for e in g[3]["similar_reviewed_rows"]]
        self.assertGreaterEqual(descriptions.count("Supply of 2 core copper cable"), 3,
                                "BOQ-A, BOQ-B and BOQ-T all carry the identical row")

    # -- S6 F2: the evaluation exclusion list (site config) --------------------------------------

    def _guidance(self, lib, conf=None, drop_key=True):
        with mock.patch.object(G, "get_library", return_value=(lib, False)),              mock.patch.object(G, "revision_family", return_value=frozenset({"BOQ-X"})),              mock.patch.dict(frappe.conf, conf or {}):
            if drop_key and conf is None:
                frappe.conf.pop(G.EVALUATION_EXCLUDE_KEY, None)
            return build_guidance("BOQ-X", self._rows())

    def test_an_absent_or_empty_evaluation_list_changes_nothing(self):
        """Production has no list: the guidance must be byte-identical to the pre-S6 rule
        (family | testproject), computed here directly."""
        lib = _small_library(testproject=["BOQ-T"])
        before = json.dumps(G.guidance_for_rows(self._rows(), lib, frozenset({"BOQ-X", "BOQ-T"})), sort_keys=True)
        absent = json.dumps(self._guidance(lib), sort_keys=True)
        empty = json.dumps(self._guidance(lib, {G.EVALUATION_EXCLUDE_KEY: []}), sort_keys=True)
        self.assertEqual(hashlib.sha256(absent.encode()).hexdigest(), hashlib.sha256(before.encode()).hexdigest())
        self.assertEqual(empty, before)
        self.assertEqual(json.loads(absent)["3"]["similar_reviewed_rows"][0]["description"],
                         "Supply of 2 core copper cable", "the vacuity partner: BOQ-A / BOQ-B rows are there")

    def test_a_filled_evaluation_list_keeps_those_boqs_out(self):
        lib = _small_library(testproject=["BOQ-T"])
        g = self._guidance(lib, {G.EVALUATION_EXCLUDE_KEY: ["BOQ-A", "BOQ-B"]})
        self.assertEqual([e["description"] for e in g[3]["similar_reviewed_rows"]],
                         ["Supply of 4 core copper cable"])

    def test_the_evaluation_list_reader(self):
        with mock.patch.dict(frappe.conf, {G.EVALUATION_EXCLUDE_KEY: ["BOQ-1", "BOQ-2"]}):
            self.assertEqual(G.evaluation_exclusions(), frozenset({"BOQ-1", "BOQ-2"}))
        with mock.patch.dict(frappe.conf, {G.EVALUATION_EXCLUDE_KEY: None}):
            self.assertEqual(G.evaluation_exclusions(), frozenset())

    def test_library_failure_continues_without_examples_and_says_so(self):
        with mock.patch.object(G, "get_library", side_effect=RuntimeError("rebuild failed")), \
             mock.patch.object(G.logger, "error") as warn:
            g = build_guidance("BOQ-A", self._rows())
        self.assertEqual(sorted(g), [2, 3])
        self.assertTrue(all(e["similar_reviewed_rows"] == [] for e in g.values()))
        self.assertEqual(g[3]["candidate_parents"],
                         ["row 2 | sl A | ELECTRICAL WORKS", "none (top level)"])
        self.assertTrue(warn.called)
        message = warn.call_args.args[0] % warn.call_args.args[1:]
        self.assertIn("WITHOUT examples", message)
        self.assertIn("rebuild failed", message)

    def test_the_fallback_line_is_really_written_to_the_log(self):
        """The boq_ai logger writes ERROR and above only (Frappe's default outside the dev
        server). The "WITHOUT examples" line must therefore be an ERROR: sent through the
        REAL logger at that level it reaches a handler; a warning would be dropped."""
        import logging

        seen = []

        class _Catch(logging.Handler):
            def emit(self, record):
                seen.append((record.levelname, record.getMessage()))

        handler = _Catch()
        G.logger.addHandler(handler)
        self.addCleanup(G.logger.removeHandler, handler)
        level = G.logger.level
        G.logger.setLevel(logging.ERROR)
        self.addCleanup(G.logger.setLevel, level)
        with mock.patch.object(G, "get_library", side_effect=RuntimeError("rebuild failed")):
            build_guidance("BOQ-A", self._rows())
        self.assertEqual([lvl for lvl, _msg in seen], ["ERROR"])
        self.assertIn("WITHOUT examples", seen[0][1])
        self.assertIn("rebuild failed", seen[0][1])

    def test_lock_timeout_continues_without_examples(self):
        with mock.patch.object(G, "get_library", side_effect=Timeout("x.lock")), \
             mock.patch.object(G.logger, "error") as warn:
            g = build_guidance("BOQ-A", self._rows())
        self.assertTrue(all(e["similar_reviewed_rows"] == [] for e in g.values()))
        self.assertTrue(warn.called)

    def test_a_failed_read_does_not_poison_the_callers_transaction(self):
        def bad_family(_boq):
            frappe.db.sql('SELECT no_such_column FROM "tabBOQs"')

        with mock.patch.object(G, "get_library", return_value=(_small_library(), False)), \
             mock.patch.object(G, "revision_family", side_effect=bad_family), \
             mock.patch.object(G.logger, "error"), mock.patch("frappe.log_error"):
            g = build_guidance("BOQ-A", self._rows())
        self.assertTrue(all(e["similar_reviewed_rows"] == [] for e in g.values()))
        # The connection is still usable -- the savepoint took the failure.
        self.assertEqual(frappe.db.sql("SELECT 1")[0][0], 1)


class TestRevisionFamily(unittest.TestCase):

    def _family(self, boq, links):
        rows = [frappe._dict(name=n, source_boq=s) for n, s in links]
        with mock.patch.object(frappe.db, "sql", return_value=rows):
            return revision_family(boq)

    def test_chain_in_both_directions(self):
        links = [("B1", None), ("B2", "B1"), ("B3", "B2"), ("X1", None), ("X2", "X1")]
        for member in ("B1", "B2", "B3"):
            self.assertEqual(self._family(member, links), frozenset({"B1", "B2", "B3"}))
        self.assertEqual(self._family("X1", links), frozenset({"X1", "X2"}))

    def test_a_boq_alone_is_its_own_family(self):
        self.assertEqual(self._family("X9", [("B1", None)]), frozenset({"X9"}))

    def test_a_dangling_source_is_ignored(self):
        self.assertEqual(self._family("B2", [("B2", "GONE")]), frozenset({"B2"}))


class TestBuildLibraryRule(unittest.TestCase):
    """build_library on FAKED reads: two committed sheets, one of them a TestProject's."""

    def _fake_sql(self, query, params=None, as_dict=False):
        d = frappe._dict
        if 'FROM "tabBOQs"' in query:
            return [d(name="BOQ-1", project="P1"), d(name="BOQ-TP", project="P2")]
        if 'FROM "tabProjects"' in query:
            return [d(name="P1", project_name="Real Tower"), d(name="P2", project_name="Test Project 7")]
        if 'FROM "tabBoQ Sheet"' in query:
            role_map = {"A": {"role": "sl_no"}, "B": {"role": "description"},
                        "C": {"role": "unit"}, "D": {"role": "qty_total"},
                        "E": {"role": "rate_supply"}, "F": {"role": "amount_total"}}
            return [d(name="SH-1", boq="BOQ-1", sheet_name="Elec", column_role_map=role_map),
                    d(name="SH-TP", boq="BOQ-TP", sheet_name="Elec", column_role_map=role_map),
                    d(name="SH-EMPTY", boq="BOQ-1", sheet_name="NoNodes", column_role_map={})]
        if 'FROM "tabBOQ Nodes"' in query:
            if params[0] == "SH-EMPTY":
                return []
            return [d(source_row_number=5, row_class="preamble"),
                    d(source_row_number=6, row_class="line_item")]
        if 'FROM "tabBoQ Review Row"' in query:
            return [d(source_row_number=5, classification="line_item", human_classification="preamble"),
                    d(source_row_number=6, classification="line_item", human_classification=None),
                    d(source_row_number=7, classification="spacer", human_classification=None)]
        if 'FROM "tabBoQ Committed Sheet Grid Row"' in query:
            return [d(row_number=5, cells={"A": "A", "B": " LT CABLES ", "E": 111.5}),
                    d(row_number=6, cells={"A": "1.1", "B": "2 core cable", "C": "m", "D": 40,
                                           "E": 98765.4321, "F": 3950617.28})]
        raise AssertionError(f"unexpected query: {query}")

    def _build(self):
        with mock.patch.object(frappe.db, "sql", side_effect=self._fake_sql), \
             mock.patch.object(frappe.db, "get_value", return_value="GRID-1"):
            return G.build_library()

    def test_truth_is_the_committed_row_class_and_blank_rows_join_a_verified_sheet(self):
        lib = self._build()
        mine = [r for r in lib.rows if r["boq"] == "BOQ-1"]
        self.assertEqual([(r["excel_row"], r["truth_type"]) for r in mine],
                         [(5, "preamble"), (6, "line_item"), (7, "spacer")])
        self.assertEqual(mine[0]["description"], "LT CABLES")
        self.assertEqual((mine[1]["sl_no"], mine[1]["unit"], mine[1]["has_qty"]), ("1.1", "m", True))
        self.assertFalse(mine[0]["has_qty"])

    def test_a_sheet_without_nodes_contributes_nothing(self):
        self.assertNotIn("NoNodes", {r["sheet"] for r in self._build().rows})

    def test_no_rate_or_amount_value_reaches_the_library(self):
        """NEGATIVE: the rate / amount columns are never read; a quantity survives only
        as has_qty true / false."""
        lib = self._build()
        text = repr(lib.rows)
        for leak in ("98765", "3950617", "111.5", "40"):
            self.assertNotIn(leak, text)
        self.assertEqual(sorted(lib.rows[0]),
                         ["boq", "description", "excel_row", "has_qty", "sheet", "sl_no",
                          "truth_type", "unit"])

    def test_testproject_boqs_stay_in_the_file_and_are_marked_for_exclusion(self):
        lib = self._build()
        self.assertEqual(lib.testproject, frozenset({"BOQ-TP"}))
        self.assertIn("BOQ-TP", {r["boq"] for r in lib.rows})
        out = lib.top5({"description": "2 core cable", "sl_no": "1.1", "has_qty": True},
                       exclude=lib.testproject)
        self.assertEqual({e["boq"] for e in out}, {"BOQ-1"})


# ===========================================================================
# S2: the compact in-memory library (file format 2) and its release
# ===========================================================================

class _Format1Library:
    """The S1b library, kept here word for word as the REFERENCE: format 2 must return exactly
    what this returns (same examples, same order, same scores) for any input."""

    def __init__(self, rows):
        import collections
        import math
        from array import array
        self.rows = rows
        self.N = len(rows)
        self.logN = math.log(self.N) if self.N else 0.0
        df = collections.Counter()
        for b in rows:
            df.update(G._toks(b['description']).keys())
        self.idf = {k: math.log(self.N / v) for k, v in df.items()}
        self.ids, self.wts = {}, {}
        for j, b in enumerate(rows):
            for k, x in self._vec(G._toks(b['description'])).items():
                if k not in self.ids:
                    self.ids[k] = array('l')
                    self.wts[k] = array('d')
                self.ids[k].append(j)
                self.wts[k].append(x)
        self.blank = [j for j, b in enumerate(rows) if not (b['description'] or '').strip()]
        self.shape = [sl_shape(b['sl_no']) for b in rows]

    def _vec(self, tf):
        import math
        v = {k: c * self.idf.get(k, self.logN) for k, c in tf.items()}
        n = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {k: x / n for k, x in v.items()}

    def top5(self, query, exclude=frozenset()):
        import collections
        tv = self._vec(G._toks(query['description']))
        acc = collections.defaultdict(float)
        for k, x in tv.items():
            ids = self.ids.get(k)
            if ids is None:
                continue
            for j, y in zip(ids, self.wts[k]):
                acc[j] += x * y
        cand = list(acc.items()) if acc else [(j, 0.0) for j in self.blank]
        rows = self.rows
        qs = sl_shape(query['sl_no'])
        qh = query['has_qty']
        scored = sorted(
            (
                (cos + (0.15 if rows[j]['has_qty'] == qh else 0.0)
                 + (0.10 if self.shape[j] == qs else 0.0), j)
                for j, cos in cand if rows[j]['boq'] not in exclude
            ),
            key=lambda x: -x[0],
        )[:G.EXAMPLES_PER_ROW]
        return [
            {
                'boq': rows[j]['boq'], 'sheet': rows[j]['sheet'], 'sl_no': rows[j]['sl_no'],
                'description': (rows[j]['description'] or '')[:120],
                'unit': rows[j]['unit'], 'has_qty': rows[j]['has_qty'],
                'correct_row_type': rows[j]['truth_type'], 'score': round(sc, 4),
            }
            for sc, j in scored
        ]


def _varied_rows(n=400, seed=7):
    """A deterministic library with repeats, near-duplicates, blanks, long and non-ASCII text."""
    import random
    rnd = random.Random(seed)
    words = ["supply", "fixing", "cable", "copper", "2 core", "4 core", "panel", "pipe", "80 NB",
             "150 mm dia", "SITC", "of", "and", "valve", "duct", "GI", "MS", "insulation", "25\u00b0C",
             "\u20b9 rate only", "testing", "commissioning", "as per IS", "complete"]
    sls = ["", "1", "1.1", "2.3.4", "A", "a)", "iv", "B-2", "12.0", "x1"]
    types = ["line_item", "preamble", "note", "spacer", "subtotal"]
    rows = []
    for i in range(n):
        if i % 23 == 0:
            desc = ""
        elif i % 17 == 0:
            desc = "Supply of 2 core copper cable"                      # exact repeats
        else:
            desc = " ".join(rnd.choice(words) for _ in range(rnd.randint(1, 40)))
        rows.append({
            "boq": f"BOQ-{i % 9}", "sheet": f"S{i % 4}", "excel_row": i + 2,
            "sl_no": rnd.choice(sls), "description": desc, "unit": rnd.choice(["", "m", "nos", "kg"]),
            "has_qty": bool(i % 3), "truth_type": rnd.choice(types),
        })
    return rows


class TestCompactLibrary(_TempDirCase):

    def test_file_format_is_two_and_the_file_name_carries_it(self):
        self.assertEqual(G._LIBRARY_FORMAT, 2)
        with mock.patch.object(frappe, "get_site_path", side_effect=lambda *p: "/".join(p)):
            self.assertEqual(G.library_path(), "private/boq_ai/examples_library_v2.pkl")

    def test_identical_to_the_format_1_library_for_every_query(self):
        rows = _varied_rows()
        old, new = _Format1Library(rows), ExamplesLibrary(rows)
        queries = [{"description": r["description"], "sl_no": r["sl_no"], "has_qty": r["has_qty"]}
                   for r in rows]
        queries += [
            {"description": "", "sl_no": "", "has_qty": False},
            {"description": "   ", "sl_no": "3", "has_qty": True},
            {"description": "zzzz never seen qqqq", "sl_no": "9.9", "has_qty": False},
            {"description": "Supply of 2 core copper cable 25\u00b0C", "sl_no": "c)", "has_qty": True},
            {"description": None, "sl_no": None, "has_qty": None},
            # words the library has never seen, mixed with words it has (they still weigh in)
            {"description": "Supply of 2 core copper cable qqqqzz wwwwxx", "sl_no": "1.1", "has_qty": True},
            {"description": "valve zzzzzzzzzzzzzzzzzzzz", "sl_no": "", "has_qty": False},
        ]
        differences = 0
        for q in queries:
            for exclude in (frozenset(), frozenset({"BOQ-1", "BOQ-4"})):
                if old.top5(q, exclude) != new.top5(q, exclude):
                    differences += 1
        self.assertEqual(differences, 0)
        self.assertGreater(len(queries), 400)

    def test_identical_after_a_save_and_load(self):
        rows = _varied_rows(150, seed=3)
        save_library(ExamplesLibrary(rows, testproject=["BOQ-2"]), self.path)
        old, new = _Format1Library(rows), load_library(self.path)
        self.assertEqual(new.testproject, frozenset({"BOQ-2"}))
        for r in rows:
            q = {"description": r["description"], "sl_no": r["sl_no"], "has_qty": r["has_qty"]}
            self.assertEqual(old.top5(q), new.top5(q))

    def test_no_per_row_dict_and_no_per_token_object_is_kept(self):
        from array import array
        lib = ExamplesLibrary(_varied_rows(50))
        state = lib.state()
        self.assertNotIn("rows", state)
        for name in ("post_ids", "post_cnt", "post_start", "norm", "idf", "tok_off", "desc_off"):
            self.assertIsInstance(state[name], array, name)
        for name in ("tok_blob", "desc_blob", "sl_blob", "unit_blob"):
            self.assertIsInstance(state[name], bytes, name)
        self.assertFalse([v for v in vars(lib).values() if isinstance(v, dict) and len(v) > 20],
                         "no large dict (the old per-token index) on the library")

    def test_rows_are_still_readable_for_inspection(self):
        rows = [_lib_row("BOQ-A", "cable " * 60, "line_item", "1.1", "m", True),
                _lib_row("BOQ-B", "", "spacer")]
        lib = ExamplesLibrary(rows)
        self.assertEqual(lib.N, 2)
        got = lib.rows
        self.assertEqual([(r["boq"], r["sheet"], r["excel_row"], r["sl_no"], r["unit"], r["has_qty"],
                           r["truth_type"]) for r in got],
                         [("BOQ-A", "S", 1, "1.1", "m", True, "line_item"),
                          ("BOQ-B", "S", 1, "", "", False, "spacer")])
        self.assertEqual(got[0]["description"], ("cable " * 60)[:120],
                         "only the 120 characters an example can show are kept")

    def test_an_s1b_format_1_file_is_refused_and_rebuilt(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "wb") as f:
            pickle.dump({"format": 1, "built_at": time.time(), "rows": [], "testproject": [],
                         "idf": {}, "ids": {}, "wts": {}, "blank": [], "shape": []}, f, protocol=5)
        with self.assertRaises(ValueError):
            load_library(self.path)
        with mock.patch.object(G, "build_library", return_value=_small_library()) as build:
            lib, rebuilt = get_library(self.path)
        self.assertTrue(rebuilt)
        self.assertEqual(build.call_count, 1)
        self.assertEqual(lib.N, 7)

    def test_empty_library(self):
        lib = ExamplesLibrary([])
        self.assertEqual(lib.top5({"description": "cable", "sl_no": "1", "has_qty": True}), [])
        again = ExamplesLibrary.from_state(pickle.loads(pickle.dumps(lib.state(), protocol=5)))
        self.assertEqual(again.N, 0)


class TestLibraryReleaseAndInfo(unittest.TestCase):

    def _rows(self):
        return [
            _review_row(0, 2, "preamble", sl="A", desc="ELECTRICAL WORKS"),
            _review_row(1, 3, "line_item", parent=0, sl="1.1",
                        desc="Supply of 2 core copper cable", unit="m", qty=3),
        ]

    def test_the_library_is_released_before_build_guidance_returns(self):
        import gc
        import weakref
        alive = []

        def get_library():
            # Built here so that build_guidance holds the ONLY reference (a mock's return_value
            # would keep one of its own).
            lib = _small_library()
            alive.append(weakref.ref(lib))
            return lib, False

        with mock.patch.object(G, "get_library", side_effect=get_library), \
             mock.patch.object(G, "revision_family", return_value=frozenset()):
            g = build_guidance("BOQ-X", self._rows())
        gc.collect()
        self.assertIsNone(alive[0](), "nothing may still hold the library when the Claude call starts")
        self.assertTrue(g[3]["similar_reviewed_rows"], "the examples were copied out before the release")

    def test_info_reports_the_library_step(self):
        cases = [((_small_library(), False), "ok"), ((_small_library(), True), "rebuilt")]
        for returned, status in cases:
            info = {}
            with mock.patch.object(G, "get_library", return_value=returned), \
                 mock.patch.object(G, "revision_family", return_value=frozenset()):
                build_guidance("BOQ-X", self._rows(), info=info)
            self.assertEqual(info["library_status"], status)
            self.assertEqual(info["library_rows"], 7)
            for key in ("library_seconds", "lookup_seconds"):
                self.assertIsInstance(info[key], float, key)
            if os.path.exists("/proc/self/status"):
                for key in ("library_memory_peak_mib", "memory_before_mib",
                            "memory_after_lookup_mib", "memory_after_release_mib"):
                    self.assertGreater(info[key], 0, key)
                self.assertGreaterEqual(info["library_memory_peak_mib"], info["memory_after_lookup_mib"])

    def test_info_says_no_examples_fallback_when_the_library_cannot_be_had(self):
        info = {}
        with mock.patch.object(G, "get_library", side_effect=RuntimeError("rebuild failed")), \
             mock.patch.object(G.logger, "error"):
            g = build_guidance("BOQ-X", self._rows(), info=info)
        self.assertEqual(info["library_status"], "no-examples fallback")
        self.assertEqual(info["library_rows"], 0)
        self.assertEqual(g[3]["similar_reviewed_rows"], [])

    def test_info_is_optional(self):
        with mock.patch.object(G, "get_library", return_value=(_small_library(), False)), \
             mock.patch.object(G, "revision_family", return_value=frozenset()):
            self.assertEqual(sorted(build_guidance("BOQ-X", self._rows())), [2, 3])

    def test_no_scheduled_rebuild_exists(self):
        """Owner ruling R4: the library is rebuilt ON DEMAND only."""
        hooks_text = repr(frappe.get_hooks("scheduler_events"))
        self.assertNotIn("boq_ai_guidance", hooks_text)
        self.assertNotIn("build_library", hooks_text)
