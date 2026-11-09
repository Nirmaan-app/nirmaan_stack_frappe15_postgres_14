# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt
"""THE 6-MONTH CUT-OFF of the historical pool (DEV2-B9). Owner R-H2B (2026-10-30 00:53): "lets keep the cutoff as 6
months"; 2026-11-10: "Hard cut-off" (an older row is never shown, no soft fallback), "committ date" (the date the earlier
BoQ was COMMITTED - not the date its rate was set, not the BoQ's creation date) and, answer 2 to B9-Q1, "option D": each
row is aged by ITS OWN SHEET's commit.

    cutoff_date(at, months)               -> the first commit day a build at `at` still keeps
    sheet_commit_dates()                  -> {(boq, sheet_name): the current sheet's committed_at}  (READ ONLY)
    apply_cutoff(rows, kept, at, months)  -> (kept, aged row keys, summary)

THE RULE. pool.build_pool keeps a row only when its sheet was COMMITTED on or after the cut-off date (00:00 IST): the
build moment's date in Asia/Kolkata, `pool.POOL_MAX_AGE_MONTHS` calendar months back. A day the target month lacks
clamps to its last day (a build on 31 Aug keeps 28 / 29 Feb on; one on 30 Nov keeps 30 May on). Hard: an aged row leaves
the KEPT set and is never a 2X extra (Pool.extra_for), so no target is offered it. Sheets of one BoQ can age out on
different days. A row whose sheet has no commit date is treated as too old and counted apart. Every row stays in the
file and the index (the index's statistics do not move); only which rows may be offered changes. A row ages out at the
next build (the 06:00 job); its stored spec card stays, unused. The 3-day rule, R-H2S, the test-project rule, the
cards, the judge and the lanes are unchanged.

THE COMMIT DATE (DEV2-B9 P0 (b), owner answer 2): the CURRENT `BoQ Sheet.committed_at` of the row's sheet (the pool's
rows come from current sheets only). The commit pipeline writes it once per sheet commit (the same value goes to the
committed grid and the sheet's nodes); a re-commit writes a NEW current sheet version with its own committed_at and
freezes the old one, so a re-commit resets that sheet's age only. 100 % filled on dev2. Revision families: R-H2S picks
the version that enters; each of its rows is then aged by its own sheet.

TIME ZONE. Stored datetimes and now_datetime() are naive in the site's system time zone (Asia/Kolkata on dev2 and
production; the 06:00 cron runs in it). Both are converted to Asia/Kolkata before the day is taken, so a build at
03:00 IST or a commit at 00:30 IST is dated by its IST day, never by the UTC one.
"""
import calendar
import datetime
from zoneinfo import ZoneInfo

import frappe

IST = "Asia/Kolkata"


def months_back(day, months):
    """`day` minus `months` calendar months; a day the target month lacks clamps to that month's last day."""
    y, m = divmod(day.year * 12 + day.month - 1 - months, 12)
    m += 1
    return datetime.date(y, m, min(day.day, calendar.monthrange(y, m)[1]))


def ist(dt):
    """A naive datetime in the site's system time zone -> the same moment, naive, in Asia/Kolkata."""
    dt = frappe.utils.get_datetime(dt)
    tz = frappe.utils.get_system_timezone() or IST
    if tz == IST:
        return dt
    return dt.replace(tzinfo=ZoneInfo(tz)).astimezone(ZoneInfo(IST)).replace(tzinfo=None)


def cutoff_date(at, months):
    """The first commit day (IST) a build at `at` (naive, system time zone) still keeps."""
    return months_back(ist(at).date(), months)


def sheet_commit_dates():
    """{(boq, sheet_name): committed_at} of every CURRENT committed sheet (READ ONLY)."""
    return {(b, s): c for b, s, c in frappe.db.sql('''select boq, sheet_name, committed_at from "tabBoQ Sheet"
        where is_current=1''')}


def apply_cutoff(rows, kept, at, months, commit_dates=None):
    """(kept, aged, summary) for a build at `at`. `aged` = the key of every row in `rows` whose sheet was committed
    before the cut-off or has no commit date; the returned kept set has none of them. The summary (pool.age;
    rebuild_pool prints it) counts KEPT rows only:
      cutoff_date               the first commit day still kept (ISO)
      max_age_months            the window
      rows_left_out_by_age      kept rows whose sheet was committed before the cut-off
      sheets_left_out_by_age    their sheets
      boqs_left_out_by_age      their BoQs (a BoQ with at least one sheet left out)
      rows_without_commit_date  kept rows whose sheet has no commit date (left out as well, counted apart)
    `commit_dates` ({(boq, sheet_name): datetime}) is a seam; None reads sheet_commit_dates()."""
    dates = sheet_commit_dates() if commit_dates is None else commit_dates
    cut = cutoff_date(at, months)
    day = {sk: ist(c).date() for sk, c in dates.items() if c}
    old, nodate = set(), set()
    for r in rows:
        d = day.get((r['boq'], r['sheet']))
        if d is None:
            nodate.add(r['key'])
        elif d < cut:
            old.add(r['key'])
    gone = [r for r in rows if r['key'] in kept and r['key'] in old]
    summary = {'cutoff_date': cut.isoformat(), 'max_age_months': months,
               'rows_left_out_by_age': len(gone),
               'sheets_left_out_by_age': len({(r['boq'], r['sheet']) for r in gone}),
               'boqs_left_out_by_age': len({r['boq'] for r in gone}),
               'rows_without_commit_date': len(nodate & set(kept))}
    frappe.logger('boq_rate_match').info('match pool cut-off: %s', summary)   # every build's line (the after-deploy check)
    return set(kept) - old - nodate, old | nodate, summary
