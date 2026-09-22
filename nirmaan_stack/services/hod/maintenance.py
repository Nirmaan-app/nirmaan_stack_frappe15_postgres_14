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
"""

PERIODS = (("list_1", "Six Months Report"), ("list_2", "Yearly Report"))


def _dict(value) -> dict:
	return value if isinstance(value, dict) else {}


def _text(value) -> str:
	return str(value or "").strip()


def sheets(blocks, form_data) -> list:
	"""The printed sheets, in order: one per block and non-empty list.

	`blocks` are the included library blocks as dicts (`name`, `title`, `list_1`, `list_2` -- lists of item
	text). Returns `[{"title", "period", "rows": [{"no", "item", "result", "remarks"}], "comments"}]`."""
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
			out.append({"title": block.get("title") or "", "period": period, "rows": rows, "comments": _text(sheet.get("comments"))})
	return out
