# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""SLICE 1e -- the Excel half of the rate-file round trip. PURE: bytes in, rows out; rows in, bytes out.

WHY EXCEL BY DEFAULT (owner X-a, 2026-09-22). The owner downloaded the HVAC CSV, added one row in Excel
and uploaded it: Excel had rewritten the panel ratios "1:6" and "1:4" as the TIMES 01:06 and 01:04 on
the way through, and the spec reader (correctly) refused them. A CSV carries no cell types, so Excel
guesses -- and a guess it makes silently is exactly what a rate file cannot afford. An .xlsx carries
the type: every text column here is written with the TEXT number format ("@"), at the CELL and at the
COLUMN, so a value is shown and re-read as typed, and a row a user adds below the data inherits the
column's text format before they type into it.

WHAT IS TEXT AND WHAT IS A NUMBER is decided by the CALLER (the exporter knows the discipline's column
spaces): the identity columns, the category / kind labels, `item_name` / `item_detail` and every
attribute whose definition is not numeric are TEXT; the rate and markup columns and the numeric
attributes are NUMBERS, written exactly (a float is a float, never rounded or formatted).

READING is the mirror and is deliberately DUMB: a cell comes back as the string the CSV path would
have read -- text as is, a number as `str()` (openpyxl hands back `int` for an integral float, so a
stored `2.0` comes back as "2", which `csv_importer.coerce_rate` reads as 2.0 -- the same value), a
date or time as its ISO text so it SURFACES as a change or a refusal rather than vanishing. Nothing is
repaired here; the importer's preview is the defence, as it always was.

DETECTION IS BY CONTENT, never by file name: an .xlsx is a zip and starts with the four bytes
`PK\\x03\\x04`; anything else is handed to the CSV decoder unchanged.

openpyxl is already a dependency of frappe and of this app (VERIFIED: 3.1.5 in the bench env,
`Required-by: frappe, nirmaan_stack`). No new dependency.
"""

import datetime
import io

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.utils import get_column_letter

XLSX_MAGIC = b"PK\x03\x04"
XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
CSV_CONTENT_TYPE = "text/csv"
TEXT_FORMAT = "@"
SHEET_TITLE = "rate_master"
# SLICE 12a: the formula row's and the formula columns' presentation. Colour is emphasis only -- a
# reader who cannot see colour still gets the text, which is why the CSV drops it and stays complete.
FORMULA_ROW_COLOR = "FF1F4E79"     # dark blue: the column-level explanations
FORMULA_CELL_COLOR = "FF555555"    # grey: the per-row formula columns, quieter than the data
FORMULA_COL_WIDTH = 52
# Owner, 2026-09-27: the FORMULA ROW gets exactly THREE standard rows of height and every other row stays
# standard. Excel's default row is 15 pt at Calibri 11, so the formula row is 45.
# ⚠️ THE DATA ROWS NEED AN EXPLICIT HEIGHT, not merely an unset one: the two formula COLUMNS wrap, and a
# wrapped cell with no explicit height makes Excel AUTO-FIT the row -- which is exactly what made every
# row of the review files three to eight lines tall. An explicit height clips instead, which is what
# "all other rows should be standard height" asks for; the full text is still in the cell, and on the
# Rate Master screen it is shown in full.
STANDARD_ROW_HEIGHT = 15.0
FORMULA_ROW_LINES = 3
# Column-width bounds, in Excel character units. The lower bound keeps a narrow column readable; the
# upper stops one long explanation from making a column absurdly wide -- a note that cannot fit in three
# lines at the maximum simply clips, and the screen carries it in full.
MIN_COL_WIDTH = 10
MAX_COL_WIDTH = 46
# SLICE 12a (owner, 2026-09-27) -- A DERIVED CELL MUST BE UNMISTAKABLE IN EXCEL. The owner's words on
# the review files: "i cannot make out". The cause is that an EMPTY cell in a rate file already means
# three other things -- not applicable, not filled in yet, and now not editable -- so THREE signals ride
# together, and each one alone was found insufficient:
#   * a GREY FILL and a thin border, so it is visibly not an ordinary empty cell;
#   * the WORD `derived` IN the cell, so it is never empty at all (and the CSV, which can carry neither
#     colour nor protection, has ONLY this);
#   * SHEET PROTECTION with every other cell unlocked, so Excel itself refuses the keystroke.
# All three key off the ONE predicate the upload refusal uses (`config_validation.derived_cells`),
# never a second list.
DERIVED_FILL_HEX = "FFD9D9D9"      # light grey: legible, and not a status colour this file uses
DERIVED_FONT_HEX = "FF7F7F7F"
DERIVED_BORDER_HEX = "FF9C9C9C"


def is_xlsx(raw):
    """True when the bytes are a zip container (every .xlsx is one). A str is never an xlsx."""
    return isinstance(raw, (bytes, bytearray)) and bytes(raw[:4]) == XLSX_MAGIC


def write_xlsx(headers, rows, numeric_columns, formula_row=None, wrap_columns=(),
               fill_columns_by_row=None):
    """bytes of a one-sheet workbook. `rows` are lists of raw values aligned with `headers`; a column
    named in `numeric_columns` is written as a NUMBER when its value is an int / float (a None is an
    empty cell; anything else falls back to text); every other column is TEXT, cell and column.

    SLICE 12a -- TWO ADDITIVE PARAMS, and both default to today's behaviour exactly:
      * `formula_row` is written directly UNDER the header (the header must stay row 1 -- `read_xlsx`
        and `csv_importer.parse_csv_text` both read row 1 as the headers). It wraps, so its multi-line
        explanations show as lines rather than one long string, and it is COLOURED so a reader can see
        at a glance that it is not data.
      * `wrap_columns` names the columns whose DATA cells wrap and take the quieter formula colour.
      * `fill_columns_by_row` is one set of column NAMES per data row -- the cells that must read as
        NOT EDITABLE. They take a red fill, because slice 12a exports a derived cost EMPTY and an empty
        cell says nothing about whether a pricer may type in it (owner, 2026-09-27).
    Colour is EMPHASIS ONLY: `read_xlsx` returns a plain `str` and drops it, so it can never affect
    change detection -- which is doubly true because the importer ignores these columns anyway.
    """
    numeric = set(numeric_columns or ())
    wrap = set(wrap_columns or ())
    fills = list(fill_columns_by_row or ())
    derived_fill = PatternFill(fill_type="solid", start_color=DERIVED_FILL_HEX,
                               end_color=DERIVED_FILL_HEX)
    _thin = Side(style="thin", color=DERIVED_BORDER_HEX)
    derived_border = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)
    unlocked = Protection(locked=False)
    locked = Protection(locked=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET_TITLE
    ws.append(list(headers))
    for c_idx in range(1, len(list(headers)) + 1):
        ws.cell(row=1, column=c_idx).protection = Protection(locked=False)
    for col_idx, name in enumerate(headers, start=1):
        if name not in numeric:
            ws.column_dimensions[get_column_letter(col_idx)].number_format = TEXT_FORMAT
        if name in wrap:
            # a FLOOR, not a fixed width: the sizing pass above may widen it for its own note
            ws.column_dimensions[get_column_letter(col_idx)].width = min(FORMULA_COL_WIDTH,
                                                                        MAX_COL_WIDTH)
    first_data_row = 2
    if formula_row:
        for c_idx, value in enumerate(formula_row, start=1):
            cell = ws.cell(row=2, column=c_idx)
            cell.number_format = TEXT_FORMAT
            if value not in (None, ""):
                cell.value = str(value)
            cell.font = Font(color=FORMULA_ROW_COLOR, italic=True)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            cell.protection = Protection(locked=False)
        first_data_row = 3
    for r_idx, row in enumerate(rows, start=first_data_row):
        marked = fills[r_idx - first_data_row] if r_idx - first_data_row < len(fills) else ()
        for c_idx, (name, value) in enumerate(zip(headers, row), start=1):
            cell = ws.cell(row=r_idx, column=c_idx)
            if value is None or value == "":
                if name not in numeric:
                    cell.number_format = TEXT_FORMAT
                # ⚠️ A DERIVED CELL IS EMPTY, so this branch is the ONE that has to fill it. Putting
                # the fill only after the value write would leave every derived cell unmarked -- the
                # exact gap the owner found on the review files.
                if name in marked:
                    cell.fill = derived_fill
                    cell.border = derived_border
                    cell.protection = locked
                else:
                    cell.protection = unlocked
                continue
            if name in numeric and isinstance(value, (int, float)) and not isinstance(value, bool):
                cell.value = value
            else:
                cell.value = str(value)
                cell.number_format = TEXT_FORMAT
            if name in wrap:
                cell.font = Font(color=FORMULA_CELL_COLOR)
                cell.alignment = Alignment(wrap_text=True, vertical="top")
            if name in marked:
                cell.fill = derived_fill
                cell.border = derived_border
                cell.font = Font(color=DERIVED_FONT_HEX, italic=True)
                cell.protection = locked
            else:
                cell.protection = unlocked
    ws.freeze_panes = "A%d" % first_data_row

    # Owner, 2026-09-27 -- SIZE THE COLUMNS SO THE FORMULA ROW FITS IN THREE LINES, and pin every other
    # row to the standard height. The width a note needs is its longest LINE and its total length spread
    # over three lines, whichever is greater; the header must fit too, or the column reads as unnamed.
    if formula_row:
        for c_idx, (name, note) in enumerate(zip(headers, formula_row), start=1):
            letter = get_column_letter(c_idx)
            text = "" if note in (None, "") else str(note)
            longest = max((len(l) for l in text.split(chr(10))), default=0)
            spread = -(-len(text) // FORMULA_ROW_LINES) if text else 0
            want = max(len(str(name)) + 2, min(longest, spread if spread > longest else longest))
            want = max(want, min(spread, MAX_COL_WIDTH))
            existing = ws.column_dimensions[letter].width
            ws.column_dimensions[letter].width = max(
                existing or 0, min(max(want, MIN_COL_WIDTH), MAX_COL_WIDTH))
        ws.row_dimensions[2].height = STANDARD_ROW_HEIGHT * FORMULA_ROW_LINES
    for r_idx in range(first_data_row, first_data_row + len(rows)):
        ws.row_dimensions[r_idx].height = STANDARD_ROW_HEIGHT

    if fills:
        # SHEET PROTECTION, NO PASSWORD (a password would lock the owner out of his own file). Only the
        # derived cells stay locked; everything else is explicitly unlocked above. Sorting, filtering and
        # inserting or deleting rows and columns are all left ALLOWED -- in openpyxl's SheetProtection a
        # True means BLOCKED, so each of these must be False or the owner could not delete the formula
        # row, add an item, or sort the sheet.
        ws.protection.sheet = True
        # NO PASSWORD, and that means NOT SETTING ONE: openpyxl's `password` setter hashes its
        # argument, so assigning None raises. An unset password is exactly what the owner asked for.
        ws.protection.sort = False
        ws.protection.autoFilter = False
        ws.protection.insertRows = False
        ws.protection.deleteRows = False
        ws.protection.insertColumns = False
        ws.protection.deleteColumns = False
        ws.protection.formatCells = False
        ws.protection.formatColumns = False
        ws.protection.formatRows = False
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _cell_text(value):
    """The string the CSV path would have read for this cell. Never a repair: a datetime becomes its
    ISO text so the importer SEES it (as a change, or a refusal by the spec reader)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    return str(value)


#: SLICE 12c-U (owner U6): the physical row the FIRST data row occupies -- the header is row 1.
#: ⚠️ DEFINED HERE RATHER THAN IMPORTED FROM `csv_importer`, WHICH IMPORTS THIS MODULE: taking it
#: the other way round would be a cycle. `csv_importer.PHYSICAL_FIRST_DATA_ROW` must equal this, and
#: `test_spec_reader.test_u01` pins the two together so they cannot drift.
PHYSICAL_FIRST_DATA_ROW = 2


def read_xlsx(raw):
    """(headers, data_rows) in exactly the shape `csv_importer.parse_csv_text` returns: headers
    stripped, data_rows = [(PHYSICAL row number, [cell text, ...]), ...]. The FIRST worksheet is
    read; a workbook with no rows yields ([], []).

    ⚠️ SLICE 12c-U (owner U6, "Report the real Excel row"): the number paired with each row is the
    row as EXCEL NUMBERS IT -- the header is row 1, so the first data row is 2 and, on a file that
    carries the formula/explanation row, the first SKU is 3. It used to be a 1-based index over data
    rows, which every refusal then reported one short. See `csv_importer.parse_csv_text` for why the
    fix lives at the two readers and not at the message sites."""
    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    try:
        ws = wb.worksheets[0]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()
    # openpyxl pads to the sheet's max column; trailing fully-empty rows are dropped, blank cells kept
    while rows and not any(c not in (None, "") for c in rows[-1]):
        rows.pop()
    if not rows:
        return [], []
    headers = [(_cell_text(h)).strip() for h in rows[0]]
    # a trailing run of blank HEADER cells is not a column (Excel widens the used range easily)
    while headers and headers[-1] == "":
        headers.pop()
    width = len(headers)
    data = []
    for i, r in enumerate(rows[1:], start=PHYSICAL_FIRST_DATA_ROW):
        cells = [_cell_text(c) for c in r[:width]]
        if len(r) > width and any(c not in (None, "") for c in r[width:]):
            # a value beyond the header's width is kept so the importer reports it as it does for CSV
            cells = [_cell_text(c) for c in r]
        data.append((i, cells))
    return headers, data
