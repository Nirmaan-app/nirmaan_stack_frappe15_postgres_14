# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Escalation Chart's levels (#1). PURE.

The number of levels is NOT fixed (owner 2026-09-23): a project fills the three the workbooks show and
adds a fourth (or more) when the client needs one. So nothing is configured and no field stores a count --
the rows a project saved in `form_data.levels` ARE the levels, and each row's label is its position.

The chart prints these rows, and the Equipment Warranty certificate prints the same contacts, so both
follow a project's own list through this one function.
"""

# What a project starts with, and the fewest rows the sheet prints (blank ones are filled in by hand).
DEFAULT_LEVELS = 3
FIELDS = ("name", "designation", "phone", "email")

_SUFFIX = {1: "st", 2: "nd", 3: "rd"}


def level_label(index: int) -> str:
	"""0 -> "1st Level", 3 -> "4th Level", 10 -> "11th Level"."""
	n = index + 1
	suffix = "th" if 11 <= n % 100 <= 13 else _SUFFIX.get(n % 10, "th")
	return f"{n}{suffix} Level"


def levels(form_data) -> list:
	"""The rows the chart prints: every level the project saved, never fewer than DEFAULT_LEVELS."""
	saved = form_data.get("levels") if isinstance(form_data, dict) else None
	saved = [lv if isinstance(lv, dict) else {} for lv in saved] if isinstance(saved, list) else []
	out = []
	for i in range(max(len(saved), DEFAULT_LEVELS)):
		lv = saved[i] if i < len(saved) else {}
		row = {"label": level_label(i)}
		row.update({f: str(lv.get(f) or "").strip() for f in FIELDS})
		out.append(row)
	return out
