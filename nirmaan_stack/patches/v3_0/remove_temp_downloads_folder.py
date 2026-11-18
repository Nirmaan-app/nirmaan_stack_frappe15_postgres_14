# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Remove the leftover finished files of the old download token (#1664).

Bulk PDF download and commission bulk download wrote their merged PDF to `public/files/temp_downloads/<token>.bin`,
a folder the web server serves to anyone with the URL, and an hourly cron swept what nobody fetched. Both flows now
keep their file privately as a background operation (`services/background_ops.write_result_file`), so nothing
writes there any more and the cron is gone: this removes what it would have swept. Only the token files (`.bin`)
go, and the folder only when that leaves it empty. Safe to re-run.
"""

import contextlib
import os

import frappe


def execute():
	remove_leftovers(frappe.get_site_path("public", "files", "temp_downloads"))


def remove_leftovers(folder):
	"""Remove the `.bin` files in `folder`, then the folder if it is empty. Returns how many files went."""
	if not os.path.isdir(folder):
		return 0
	removed = 0
	for entry in os.scandir(folder):
		if entry.is_file() and entry.name.endswith(".bin"):
			with contextlib.suppress(FileNotFoundError):
				os.remove(entry.path)
				removed += 1
	with contextlib.suppress(OSError):
		os.rmdir(folder)
	return removed
