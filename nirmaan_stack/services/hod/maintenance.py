# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Maintenance Checklist (#7): the library's check items with the project's results. PURE.

A system's maintenance block (`HOD Library Content`) carries two item lists: `list_1` = the six-monthly
checks, `list_2` = the yearly checks. Each non-empty list prints as its own sheet (the workbook layout). Per
sheet the project fills a Result and Remarks for each item, plus Comments, stored in the row's form_data:

    {"date": "YYYY-MM-DD",
     "checks": {<library block name>: {"list_1": {"results": {<item text>: {"result": "OK", "remarks": ""}},
                                                  "comments": "..."},
                                       "list_2": {...}}}}

Results are keyed by the item's TEXT, not its position: if the wording in the library is changed in Desk, an
old result stays with the item it was written for (and stops printing) instead of sliding onto a neighbour.

The two periods are checked on DIFFERENT VISITS, so each carries its own date (owner 2026-09-25):

    {"dates": {"list_1": "YYYY-MM-DD", "list_2": "YYYY-MM-DD"}, ...}

`date` is the single date the document used before the split; it is still read as the fallback for both,
so a row saved earlier keeps printing what it had.
"""

PERIODS = (("list_1", "Six Months Report"), ("list_2", "Yearly Report"))


def _dict(value) -> dict:
	return value if isinstance(value, dict) else {}


def _text(value) -> str:
	return str(value or "").strip()


def period_date(form_data, key: str) -> str:
	"""The date of THIS period's check ("list_1" / "list_2"), or "" to be written in by hand.

	Falls back to the legacy single `date` so rows saved before the two dates still print theirs."""
	fd = _dict(form_data)
	return _text(_dict(fd.get("dates")).get(key)) or _text(fd.get("date"))


def sheets(blocks, form_data) -> list:
	"""The printed sheets, in order: one per block and non-empty list.

	`blocks` are the included library blocks as dicts (`name`, `title`, `list_1`, `list_2` -- lists of item
	text). Returns `[{"title", "period", "date", "rows": [{"no", "item", "result", "remarks"}], "comments"}]`.
	`date` is the RAW value -- the caller formats it, so this stays pure."""
	checks = _dict(_dict(form_data).get("checks"))
	out = []
	for block in blocks or []:
		per_block = _dict(checks.get(block.get("name")))
		for key, period in PERIODS:
			items = block.get(key) or []
			if not items:
				continue
			sheet = _dict(per_block.get(key))
			results = _dict(sheet.get("results"))
			rows = []
			for no, item in enumerate(items, 1):
				check = _dict(results.get(item))
				rows.append({"no": no, "item": item, "result": _text(check.get("result")), "remarks": _text(check.get("remarks"))})
			out.append(
				{
					"title": block.get("title") or "",
					"period": period,
					# Each period is a separate visit, so each sheet prints the date of ITS check.
					"date": period_date(form_data, key),
					"rows": rows,
					"comments": _text(sheet.get("comments")),
				}
			)
	return out
