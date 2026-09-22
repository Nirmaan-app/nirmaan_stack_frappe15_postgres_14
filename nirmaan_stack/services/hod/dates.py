# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Defects Liability Period printed on the Completion Certificate. PURE.

"... from the date of Commissioning, up to Twelve months, i.e. from <start> to <end>": the end is the
day BEFORE the same date twelve months later (08.01.2025 -> 07.01.2026, as in the owner's sample).
The owner's copies were hand-typed and drifted (GSS reads 25/12/2025 -> 10/03/2026); computing it
removes that.
"""

import calendar
from datetime import date, timedelta


def add_months(start: date, months: int) -> date:
	"""`start` moved by whole months, clamped to the target month's last day (31 Jan + 1 -> 28/29 Feb)."""
	month_index = start.month - 1 + months
	year = start.year + month_index // 12
	month = month_index % 12 + 1
	day = min(start.day, calendar.monthrange(year, month)[1])
	return date(year, month, day)


def dlp_end(start: date, months: int = 12) -> date:
	"""Last day of a `months`-long period that starts on `start` (inclusive)."""
	return add_months(start, months) - timedelta(days=1)
