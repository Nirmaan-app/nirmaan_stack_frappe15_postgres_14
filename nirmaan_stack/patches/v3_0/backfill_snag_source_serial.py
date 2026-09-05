"""Recover each imported Snag's S.No from the workbook it came from.

`Project Snag.source_serial` ships empty on every Snag imported before the field
existed. This patch fills it by RE-READING each batch's stored source workbook and
taking the cell the consultant actually wrote -- never by numbering the rows itself.

WHY NOT JUST NUMBER THEM. A positional number is what the snag list PDF already
falls back to when `source_serial` is blank (`row.source_serial or loop.index`), so
writing positions here would add nothing and would be indistinguishable, afterwards,
from a real consultant number. The whole value of the field is that it is THEIRS --
so a batch whose file, sheet or S.No column cannot be resolved is LEFT BLANK, and
keeps the display fallback it already has.

Batches imported BEFORE the `serial` role existed stored a four-key
`column_mapping` with no S.No in it, so the column is re-guessed off the sheet's own
header row exactly as the wizard would guess it today. A batch stored WITH a serial
mapping uses that letter as given.

HOOKS. The write is `frappe.db.set_value(..., update_modified=False)`, which bypasses
`Project Snag`'s `before_save` -- and must. That hook stamps status attribution
(`status_changed_by` / `status_changed_on`); this patch touches PROVENANCE only and
changes no status, so moving that stamp -- or `modified` -- would misreport who last
acted on hundreds of snags. Nothing else is derived from `source_serial`.

Idempotent: only ever fills a Snag whose `source_serial` is empty, so a re-run after a
later import is a no-op on everything already carried. Never fails the migrate -- a
batch that cannot be read is logged and skipped, because a missing attachment must not
block every other patch behind it.
"""

import os

import frappe

DOCTYPE = "Project Snag"
BATCH_DOCTYPE = "Project Snag Batch"


def execute():
	if not frappe.db.table_exists(DOCTYPE) or not frappe.db.has_column(DOCTYPE, "source_serial"):
		return

	filled = skipped = 0
	for batch in frappe.get_all(
		BATCH_DOCTYPE,
		fields=["name", "source_file", "source_sheet", "column_mapping"],
		limit_page_length=0,
	):
		try:
			count = _backfill_batch(batch)
		except Exception:
			# One unreadable attachment must not stop the rest -- or the migrate.
			frappe.log_error(
				title="backfill_snag_source_serial",
				message=f"Batch {batch.name}: {frappe.get_traceback()}",
			)
			count = None

		if count is None:
			skipped += 1
		else:
			filled += count

	frappe.db.commit()
	print(f"backfill_snag_source_serial: filled {filled} snag(s); {skipped} batch(es) left blank")


def _backfill_batch(batch):
	"""Fill one batch's Snags. Returns the count, or None when it cannot be read."""
	targets = frappe.get_all(
		DOCTYPE,
		filters={"batch": batch.name, "source_serial": ("in", ["", None])},
		fields=["name", "source_row"],
		limit_page_length=0,
	)
	targets = [t for t in targets if t.source_row]
	if not targets:
		return 0

	if not batch.source_file or not batch.source_sheet:
		return None

	grid = _load_grid(batch.source_file, batch.source_sheet)
	if grid is None:
		return None

	index = _serial_column_index(grid, batch.column_mapping)
	if index is None:
		return None

	from nirmaan_stack.services.snag_parser import reader  # noqa: PLC0415

	header_row = reader.find_header_row(grid)

	filled = 0
	for snag in targets:
		cells = grid[snag.source_row - 1] if snag.source_row <= len(grid) else []
		value = (cells[index] if index < len(cells) else "").strip()
		if not _looks_like_a_serial(value, snag.source_row, header_row):
			continue
		# Provenance only -- see HOOKS in the module docstring.
		frappe.db.set_value(DOCTYPE, snag.name, "source_serial", value, update_modified=False)
		filled += 1
	return filled


#: Longest cell this patch will accept as an S.No. A serial is a LABEL; anything
#: longer is prose that happens to sit in the same column.
_MAX_SERIAL_LEN = 20


def _looks_like_a_serial(value, source_row, header_row):
	"""Is this cell plausibly the consultant's S.No for that row?

	THE ASYMMETRY THAT SHAPES EVERY RULE HERE: refusing a real serial costs nothing --
	the snag stays blank and the PDF shows its running index, exactly as it does today.
	Writing the WRONG value costs a number people quote back to a consultant. So each
	test below is deliberately strict, and every one of them was earned on real data:

	1. AT OR ABOVE THE HEADER ROW there is no data region, so the cell is not a serial.
	   A human may tick such a row in anyway (ADR-0019) -- and on the owner's own
	   workbook rows 1-2 are the sheet's TITLE, which this rule alone stops from being
	   stored as two snags' S.No.
	2. A serial is SHORT.
	3. A serial contains a DIGIT. This is what separates a ticked summary row's
	   "RISK SUMMARY" from a real "A-3" -- an all-alphabetic serial is conceivable, and
	   is knowingly given up to keep prose out of the field.
	"""
	if not value:
		return False
	if header_row is not None and source_row <= header_row:
		return False
	if len(value) > _MAX_SERIAL_LEN:
		return False
	return any(ch.isdigit() for ch in value)


def _load_grid(file_url, sheet_name):
	"""The sheet as text, or None when the file or the sheet is gone."""
	import openpyxl  # noqa: PLC0415

	from nirmaan_stack.api.snags import file_io  # noqa: PLC0415
	from nirmaan_stack.services.snag_parser import reader  # noqa: PLC0415

	path = file_io._fetch_file_to_tempfile(file_url)
	try:
		workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
		try:
			if sheet_name not in workbook.sheetnames:
				return None
			return reader.read_grid(workbook[sheet_name])
		finally:
			workbook.close()
	finally:
		try:
			os.unlink(path)
		except OSError:
			pass


def _serial_column_index(grid, column_mapping):
	"""0-based index of the S.No column, or None when the sheet has none.

	A mapping stored WITH a serial letter is honoured as-is. An older four-key mapping
	has none, so the column is re-guessed off the sheet's own header row -- the same
	`guess_mapping` the wizard runs, so the patch and a fresh import agree.
	"""
	from nirmaan_stack.services.snag_parser import guess, reader  # noqa: PLC0415

	stored = (frappe.parse_json(column_mapping) or {}) if column_mapping else {}
	letter = stored.get("serial")

	if not letter:
		header_row = reader.find_header_row(grid)
		if header_row is None:
			return None
		guessed = guess.guess_mapping(reader.columns_for_header_row(grid, header_row) or [])
		letter = (guessed or {}).get("serial")

	if not letter:
		return None
	try:
		from openpyxl.utils import column_index_from_string  # noqa: PLC0415

		return column_index_from_string(letter) - 1
	except Exception:
		return None
