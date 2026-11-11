# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""Tests for THE 6-MONTH CUT-OFF of the historical pool (DEV2-B9 S1; services/boq_rate_match/pool_age.py and its hooks
in pool.py). Owner R-H2B "lets keep the cutoff as 6 months"; 2026-11-10 "Hard cut-off", "committ date"; answer 2 to
B9-Q1, "option D": each row is aged by ITS OWN SHEET's current committed_at. Fixtures and mocks only: no database
write, no model call; one test reads BoQ Sheet commit dates read-only.

  the window      a build on 10 Nov keeps commits from 10 May: one day inside kept / one day outside left out / ON the
                  cut-off date kept (00:00:00 kept, 23:59:59 the day before left out)
  month ends      31 Aug -> 28 Feb (29 in a leap year); 30 Nov -> 30 May; 31 Dec -> 30 Jun; 31 Mar -> 30 Sep; January
                  wraps the year
  IST, not UTC    a commit at 23:30 IST on the cut-off date is kept, at 23:30 IST the day before left out; on a site whose
                  system time zone is UTC the stored times are converted: 00:30 IST on the cut-off date (the day before
                  in UTC) kept, 23:30 IST the day before left out, and a build at 03:00 IST takes the IST day
  per sheet       two sheets of one BoQ: the one committed before the cut-off is left out, the other kept
  no commit date  left out, and counted apart (rows_without_commit_date, not rows_left_out_by_age)
  counting        only KEPT rows are counted; the summary carries exactly its six keys (rows / sheets / BoQs); every
                  build logs it in one line (the after-deploy check reads it)
  the commit date the sheet's CURRENT committed_at (a re-commit resets that sheet only)
  families / 2X   the picked version inside the window stays although an older version is outside it; a 2X extra from
                  an aged version is never offered (a 2X extra inside the window still is)
  build_pool      the cut-off line itself: aged rows leave KEPT (per sheet), the pool records `aged` and `age`, the
                  rows stay in the file; rebuild_pool's summary carries cutoff_date / rows_left_out_by_age /
                  sheets_left_out_by_age / boqs_left_out_by_age / rows_without_commit_date
  runs            a user's run still builds nothing (a pre-B9 pool file without the new fields is used as it is, the
                  cut-off is never computed at run time); an old pool object without `aged` still answers extra_for
"""
import datetime
import os
import shutil
import tempfile
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_match import pool as P
from nirmaan_stack.services.boq_rate_match import pool_age as A

D = datetime.datetime
BUILD = D(2026, 11, 10, 6, 0)          # the 06:00 IST build -> keeps commits on or after 2026-05-10 00:00 IST
SUMMARY_KEYS = {"cutoff_date", "max_age_months", "rows_left_out_by_age", "sheets_left_out_by_age", "boqs_left_out_by_age",
                "rows_without_commit_date"}


def _sk(name):
    """"B" -> (B, "S"); "B|T" -> (B, "T")."""
    return tuple((name.split("|") + ["S"])[:2])


def _rows(*sheets, n=2):
    out = []
    for name in sheets:
        b, s = _sk(name)
        out += [{"key": f"{b}|{s}|{i}", "boq": b, "sheet": s, "test": False} for i in range(1, n + 1)]
    return out


def _dates(d):
    return {_sk(k): v for k, v in d.items()}


def _tz(name):
    return patch("frappe.utils.get_system_timezone", return_value=name)


def _cut(commits, sheets=None, at=BUILD, kept=None, tz="Asia/Kolkata"):
    rows = _rows(*(sheets or list(commits)))
    with _tz(tz):
        return A.apply_cutoff(rows, kept if kept is not None else {r["key"] for r in rows}, at, P.POOL_MAX_AGE_MONTHS,
                              commit_dates=_dates(commits))


class TestCutoffDate(FrappeTestCase):
    def test_the_window_is_six_calendar_months(self):
        self.assertEqual(P.POOL_MAX_AGE_MONTHS, 6)
        with _tz("Asia/Kolkata"):
            self.assertEqual(A.cutoff_date(BUILD, 6), datetime.date(2026, 5, 10))

    def test_a_build_on_31_aug_keeps_from_the_end_of_february(self):
        with _tz("Asia/Kolkata"):
            self.assertEqual(A.cutoff_date(D(2027, 8, 31, 6), 6), datetime.date(2027, 2, 28))
            self.assertEqual(A.cutoff_date(D(2028, 8, 31, 6), 6), datetime.date(2028, 2, 29))   # a leap year

    def test_a_build_on_30_nov_keeps_from_30_may(self):
        with _tz("Asia/Kolkata"):
            self.assertEqual(A.cutoff_date(D(2026, 11, 30, 6), 6), datetime.date(2026, 5, 30))

    def test_31_dec_and_31_mar_clamp_to_the_30th(self):
        with _tz("Asia/Kolkata"):
            self.assertEqual(A.cutoff_date(D(2026, 12, 31, 6), 6), datetime.date(2026, 6, 30))
            self.assertEqual(A.cutoff_date(D(2027, 3, 31, 6), 6), datetime.date(2026, 9, 30))

    def test_january_wraps_the_year(self):
        self.assertEqual(A.months_back(datetime.date(2027, 1, 10), 6), datetime.date(2026, 7, 10))
        self.assertEqual(A.months_back(datetime.date(2027, 6, 15), 6), datetime.date(2026, 12, 15))


class TestApplyCutoff(FrappeTestCase):
    def test_one_day_inside_the_window_is_kept(self):
        kept, aged, age = _cut({"NEW": D(2026, 5, 11, 10)})
        self.assertEqual(kept, {"NEW|S|1", "NEW|S|2"})
        self.assertEqual(aged, set())
        self.assertEqual((age["rows_left_out_by_age"], age["sheets_left_out_by_age"], age["boqs_left_out_by_age"]), (0, 0, 0))

    def test_one_day_outside_the_window_is_left_out(self):
        kept, aged, age = _cut({"OLD": D(2026, 5, 9, 10), "NEW": D(2026, 5, 11, 10)})
        self.assertEqual(kept, {"NEW|S|1", "NEW|S|2"})
        self.assertEqual(aged, {"OLD|S|1", "OLD|S|2"})
        self.assertEqual((age["rows_left_out_by_age"], age["sheets_left_out_by_age"], age["boqs_left_out_by_age"], age["cutoff_date"]),
                         (2, 1, 1, "2026-05-10"))

    def test_exactly_on_the_cut_off_date_is_kept(self):
        kept, aged, _ = _cut({"EDGE": D(2026, 5, 10, 0, 0, 0), "EVE": D(2026, 5, 9, 23, 59, 59)})
        self.assertEqual(kept, {"EDGE|S|1", "EDGE|S|2"})
        self.assertEqual(aged, {"EVE|S|1", "EVE|S|2"})

    def test_a_commit_at_23_30_ist_on_the_cut_off_date_is_kept_and_the_day_before_is_not(self):
        kept, aged, _ = _cut({"ON": D(2026, 5, 10, 23, 30), "BEFORE": D(2026, 5, 9, 23, 30)})
        self.assertEqual(kept, {"ON|S|1", "ON|S|2"})
        self.assertEqual(aged, {"BEFORE|S|1", "BEFORE|S|2"})

    def test_ist_not_utc_on_a_site_whose_clock_is_utc(self):
        # stored 2026-05-09 19:00 UTC = 2026-05-10 00:30 IST (kept); 2026-05-09 18:00 UTC = 23:30 IST on the 9th (out)
        kept, aged, age = _cut({"EARLY": D(2026, 5, 9, 19, 0), "LATE": D(2026, 5, 9, 18, 0)}, tz="UTC")
        self.assertEqual(kept, {"EARLY|S|1", "EARLY|S|2"})
        self.assertEqual(aged, {"LATE|S|1", "LATE|S|2"})
        self.assertEqual(age["cutoff_date"], "2026-05-10")
        # a build at 2026-11-09 21:30 UTC is 2026-11-10 03:00 IST: the cut-off is the IST day's, not the UTC day's
        with _tz("UTC"):
            self.assertEqual(A.cutoff_date(D(2026, 11, 9, 21, 30), 6), datetime.date(2026, 5, 10))
            self.assertEqual(A.cutoff_date(D(2026, 11, 9, 18, 0), 6), datetime.date(2026, 5, 9))      # 23:30 IST on the 9th

    def test_sheets_of_one_boq_age_out_on_different_days(self):
        kept, aged, age = _cut({"B|S1": D(2026, 4, 1, 10), "B|S2": D(2026, 6, 1, 10)})
        self.assertEqual(kept, {"B|S2|1", "B|S2|2"})                     # the newer sheet stays
        self.assertEqual(aged, {"B|S1|1", "B|S1|2"})                     # the older sheet of the same BoQ is left out
        self.assertEqual((age["rows_left_out_by_age"], age["sheets_left_out_by_age"], age["boqs_left_out_by_age"]), (2, 1, 1))

    def test_no_commit_date_is_left_out_and_counted_apart(self):
        kept, aged, age = _cut({"NEW": D(2026, 6, 1)}, sheets=["NEW", "NODATE"])
        self.assertEqual(kept, {"NEW|S|1", "NEW|S|2"})
        self.assertEqual(aged, {"NODATE|S|1", "NODATE|S|2"})
        self.assertEqual((age["rows_without_commit_date"], age["rows_left_out_by_age"], age["boqs_left_out_by_age"]), (2, 0, 0))

    def test_only_kept_rows_are_counted(self):
        rows = _rows("OLD", "NEW")
        kept = {"OLD|S|1", "NEW|S|1", "NEW|S|2"}                          # OLD|S|2 was never kept (another rule)
        with _tz("Asia/Kolkata"):
            out, aged, age = A.apply_cutoff(rows, kept, BUILD, 6, commit_dates=_dates({"OLD": D(2026, 1, 1), "NEW": D(2026, 9, 1)}))
        self.assertEqual(out, {"NEW|S|1", "NEW|S|2"})
        self.assertEqual((age["rows_left_out_by_age"], age["sheets_left_out_by_age"], age["boqs_left_out_by_age"]), (1, 1, 1))
        self.assertEqual(aged, {"OLD|S|1", "OLD|S|2"})                    # every aged row, kept or not (extra_for reads it)

    def test_the_summary_keys(self):
        _, _, age = _cut({"NEW": D(2026, 6, 1)})
        self.assertEqual(set(age), SUMMARY_KEYS)
        self.assertEqual(age["max_age_months"], 6)

    def test_every_build_logs_one_cut_off_line(self):
        with patch.object(A.frappe, "logger") as lg:
            _, _, age = _cut({"OLD": D(2026, 1, 1), "NEW": D(2026, 6, 1)})
        lg.assert_called_once_with("boq_rate_match")
        lg.return_value.info.assert_called_once_with("match pool cut-off: %s", age)


class TestCommitDate(FrappeTestCase):
    def test_a_rows_commit_date_is_its_sheets_current_commit(self):
        """READ ONLY: a re-committed sheet reads its CURRENT version's committed_at (the re-commit resets that sheet),
        not its first commit; every current sheet is read."""
        row = frappe.db.sql("""select boq, sheet_name, committed_at from "tabBoQ Sheet" where is_current=1
            and commit_version > 1 and committed_at is not null order by boq, sheet_name limit 1""")
        if not row:
            self.skipTest("no re-committed sheet on this site")
        boq, sheet, current = row[0]
        first = frappe.db.sql("""select committed_at from "tabBoQ Sheet" where boq=%s and sheet_name=%s
            and commit_version=1""", (boq, sheet))[0][0]
        got = A.sheet_commit_dates()
        self.assertEqual(got[(boq, sheet)], current)
        self.assertLess(first, current)                                   # the re-commit wrote a newer date
        self.assertEqual(frappe.db.sql('select count(*) from "tabBoQ Sheet" where is_current=1')[0][0], len(got))


class TestFamiliesAnd2X(FrappeTestCase):
    CREATED = {"V1": "2026-03-01 10:00:00", "V2": "2026-06-01 10:00:00"}

    def _pool(self, v1_commit):
        rows = _rows("V1", "V2")
        sel, nxt = P.select_versions([["V1", "V2"]], self.CREATED, {"V1": 2, "V2": 2}, {"V1": "2026-03-02", "V2": "2026-06-02"},
                                     "2026-11-07 06:00:00")
        with _tz("Asia/Kolkata"):
            kept, aged, age = A.apply_cutoff(rows, P.kept_keys(rows, sel, [], self.CREATED), BUILD, 6,
                                             commit_dates=_dates({"V1": v1_commit, "V2": D(2026, 6, 1, 11)}))
        return P.Pool({"rows": [dict(r, wip=False) for r in rows], "kept": kept, "aged": aged, "age": age, "sel": sel, "nxt": nxt}), age

    def test_the_picked_version_inside_the_window_stays_although_an_older_one_is_outside(self):
        pool, age = self._pool(D(2026, 3, 1, 11))                        # V1 committed before 2026-05-10: aged
        self.assertEqual(pool.kept, {"V2|S|1", "V2|S|2"})                 # only the picked version counts
        self.assertEqual(age["rows_left_out_by_age"], 0)                  # V1's rows were never kept (R-H2S)
        self.assertTrue(pool.allowed("V2|S|1", "OTHER"))

    def test_a_2x_extra_from_an_aged_version_is_never_offered(self):
        pool, _ = self._pool(D(2026, 3, 1, 11))
        self.assertEqual(pool.extra_for("V2"), set())
        self.assertFalse(pool.allowed("V1|S|1", "V2", pool.extra_for("V2")))

    def test_a_2x_extra_inside_the_window_is_still_offered(self):
        pool, _ = self._pool(D(2026, 5, 20, 11))                         # V1 committed inside the window
        self.assertEqual(pool.extra_for("V2"), {"V1|S|1", "V1|S|2"})
        self.assertTrue(pool.allowed("V1|S|1", "V2", pool.extra_for("V2")))

    def test_an_old_pool_without_aged_still_answers_extra_for(self):
        sel, nxt = {"V1": "V2", "V2": "V2"}, {"V1": "V1", "V2": "V1"}
        old = P.Pool({"rows": [dict(r, wip=False) for r in _rows("V1", "V2")], "kept": {"V2|S|1", "V2|S|2"}, "sel": sel, "nxt": nxt})
        self.assertEqual(old.extra_for("V2"), {"V1|S|1", "V1|S|2"})


class _Cards(P.CardSource):
    def cards_for(self, rows):
        return {}


class TestBuildPoolCutoff(FrappeTestCase):
    """build_pool end to end on a fixture corpus (the live corpus, pricing step and index are patched out)."""

    OLD_SHEETS = {"OLD": D(2026, 4, 30, 12), "NEW": D(2026, 6, 1, 12), "NEW|T": D(2026, 5, 9, 23, 30)}

    def _corpus(self):
        boqs = {b: {"name": b, "project": "PRJ", "project_name": "Site", "boq_name": b, "creation": D(2026, 6, 1), "source_boq": None}
                for b in ("OLD", "NEW", "NODATE")}
        raw = [{"boq": b, "sheet": "S", "row": i, "cv": 1, "cat": "wiring_cabling", "disc": "Electrical", "unit_raw": "m",
                "node_type": "Line Item", "rates": {"supply_rate": 10.0}, "rate_at": {"supply_rate": "2026-07-01 10:00:00"},
                "payload": {"description": f"{b} cable row {i}", "ancestor_chain": []}} for b in boqs for i in (1, 2)]
        raw += [dict(r, sheet="T") for r in raw if r["boq"] == "NEW"]      # NEW has a second sheet, T
        return boqs, [], [], {(r["boq"], r["sheet"]): "2026-07-01 10:00:00" for r in raw}, {}, raw

    def _build(self, dates):
        step = {"rows": {}, "available": False, "reason": "fixture", "stamp": None}
        drv = {"available": False, "reason": "fixture", "lists": {}, "categories": {}}
        with patch.object(P, "_corpus", return_value=self._corpus()), \
                patch("nirmaan_stack.services.boq_ai_guidance.revision_family", side_effect=lambda b: {b}), \
                patch.object(P, "check_swg_table"), patch.object(P, "build_index", return_value={}), \
                patch("nirmaan_stack.services.boq_rate_match.pricing_step.sheet_inputs", return_value=({}, [])), \
                patch("nirmaan_stack.services.boq_rate_match.pricing_step.price_rows", return_value=step), \
                patch("nirmaan_stack.services.boq_rate_match.pricing_step.measure_driving_fields", return_value=drv), \
                patch.object(A, "sheet_commit_dates", return_value=_dates(dates)), _tz("Asia/Kolkata"):
            return P.build_pool(as_of=BUILD, card_source=_Cards(), asset=({"configs": {}}, "v"))

    def test_build_pool_leaves_aged_sheets_out_of_kept_and_records_the_summary(self):
        pool = self._build(self.OLD_SHEETS)
        self.assertEqual(len(pool.rows), 8)                              # every row stays in the file and the index
        self.assertEqual(pool.kept, {"NEW|S|1", "NEW|S|2"})               # NEW's sheet T (committed 9 May) is out
        self.assertEqual(pool.aged, {"OLD|S|1", "OLD|S|2", "NEW|T|1", "NEW|T|2", "NODATE|S|1", "NODATE|S|2"})
        self.assertEqual(pool.age, {"cutoff_date": "2026-05-10", "max_age_months": 6, "rows_left_out_by_age": 4,
                                    "sheets_left_out_by_age": 2, "boqs_left_out_by_age": 2, "rows_without_commit_date": 2})
        self.assertFalse(pool.allowed("OLD|S|1", "OTHER"))
        self.assertFalse(pool.allowed("NEW|T|1", "OTHER"))
        self.assertTrue(pool.allowed("NEW|S|1", "OTHER"))

    def test_build_pool_inside_the_window_keeps_everything(self):
        pool = self._build({"OLD": D(2026, 5, 10, 0), "NEW": D(2026, 6, 1, 12), "NEW|T": D(2026, 5, 10, 0, 30), "NODATE": D(2026, 7, 1)})
        self.assertEqual(len(pool.kept), 8)
        self.assertEqual((pool.age["rows_left_out_by_age"], pool.age["rows_without_commit_date"]), (0, 0))

    def test_rebuild_pool_summary_carries_the_cut_off(self):
        d = tempfile.mkdtemp(prefix="pool_age_rebuild_")
        try:
            built = self._build(self.OLD_SHEETS)
            with patch.object(P, "pool_path", return_value=os.path.join(d, "match_pool_v1.pkl")), \
                    patch.object(P, "build_pool", return_value=built):
                out = P.rebuild_pool()
            self.assertTrue(SUMMARY_KEYS <= set(out))
            self.assertEqual((out["cutoff_date"], out["rows_left_out_by_age"], out["sheets_left_out_by_age"], out["boqs_left_out_by_age"],
                              out["rows_without_commit_date"], out["kept"]), ("2026-05-10", 4, 2, 2, 2, 2))
            self.assertEqual(len(P.load_pool(os.path.join(d, "match_pool_v1.pkl")).aged), 6)      # saved with the file
        finally:
            shutil.rmtree(d, ignore_errors=True)


class TestRunsBuildNothing(FrappeTestCase):
    def test_a_users_run_uses_a_pre_b9_file_as_it_is_and_builds_nothing(self):
        from nirmaan_stack.services.boq_rate_match import match_run as MR
        d = tempfile.mkdtemp(prefix="pool_age_run_")
        path = os.path.join(d, "match_pool_v1.pkl")
        stamp = {"code": "c", "asset": "a"}
        try:
            P.save_pool(P.Pool({"format": P.POOL_FORMAT, "rows": [], "kept": set(), "sel": {}, "nxt": {}, "as_of": "x",
                                "pricing": {"stamp": stamp}, "secs": {}, "driving": {"available": True, "reason": None}}), path)
            no = AssertionError("a user's run must not build the pool or compute the cut-off")
            with patch.object(P, "_current_stamp", return_value=dict(stamp)), \
                    patch.object(P, "build_pool", side_effect=no), patch.object(P, "rebuild_pool", side_effect=no), \
                    patch.object(P, "ensure_pool", side_effect=no), patch.object(A, "apply_cutoff", side_effect=no), \
                    patch.object(A, "sheet_commit_dates", side_effect=no), patch.object(frappe, "enqueue", side_effect=no):
                pool, info = MR.job_pool(path=path)
            self.assertIsNotNone(pool)
            self.assertIsNone(info["not_ready"])
            self.assertFalse(hasattr(pool, "aged"))                      # used as it is until the next 06:00 build
        finally:
            shutil.rmtree(d, ignore_errors=True)
