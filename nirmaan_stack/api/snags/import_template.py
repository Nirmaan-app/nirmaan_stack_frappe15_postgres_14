"""The blank snag-list workbook the import wizard hands out.

One endpoint, one shape: a single worksheet holding a TITLE BLOCK (Project / Snag List
Name / Prepared By / Date), then the five header labels the wizard's column guess
understands, over `TEMPLATE_ROW_COUNT` ready-to-fill rows.

⚠️ THE TITLE BLOCK IS TWO CELLS PER ROW AND MUST STAY THAT WAY. `reader.row_is_header`
calls a row a header when THREE or more short text cells sit in it and any one of them
reads as a known header word, and `find_header_row` takes the FIRST such row. A
three-column title line would therefore BE the detected header row, and the wizard would
open on it with the real header row unmapped below. The verification that matters is
`find_header_row(grid) == HEADER_ROW` on the bytes this module produces.
Every label here is already in the `services/snag_parser/guess.py` vocabulary --
`Area` / `Category` / `Description` / `Remarks` claim their roles and `S.No` claims
the serial -- so a workbook filled from this template maps itself on upload with no
hand-mapping.

There is deliberately NO Status column. The import does not read one: every snag
starts at `Pending` and its status is moved in the app afterwards, so a Status column
here would invite a consultant to fill in a value that is then silently discarded.

The ruled rows ship EMPTY -- every cell, S.No included. Nothing here writes a value
a person did not: a number we printed would look like the consultant's own the moment
the sheet came back, and the import cannot tell the two apart. A row the consultant
leaves unnumbered is numbered by its position at ingest (`import_wizard._serials_for`),
which is where a number we invent belongs -- attributable to the import, not to them.

Styling mirrors the "Project Snag" print format the consultant gets back -- grey
header, grey Area column -- so the sheet they fill in and the PDF it prints to
read as the same document.

Wire contract: none. This returns a FILE (`frappe.local.response.type =
"download"`), not a payload in `frontend/src/pages/SnagList/types.ts`.
"""

from __future__ import annotations

import io
import re

import frappe

from nirmaan_stack.api.snags import require_import_access

#: Column order IS the template. Changing it changes what a consultant sends back.
#:
#: The LABELS are the consultant's own words, lifted from the snag lists this feature
#: actually receives ("Area / Location", "Snag Description" -- not "Area"/"Description").
#: `guess.py` already resolves both spellings, and the live batches prove it: every real
#: import so far mapped area->B, category->C, description->D off exactly these labels. A
#: template that words its columns differently from the file it is modelled on invites a
#: consultant to "correct" it back and hand-map on the way in.
TEMPLATE_HEADERS: "tuple[str, ...]" = (
    "S.No",
    "Area / Location",
    "Category",
    "Snag Description",
    "Remarks",
)

#: Display width per header, in the same order. Description is the one that holds
#: a sentence; the rest hold a phrase.
_COLUMN_WIDTHS: "tuple[int, ...]" = (8, 24, 22, 60, 32)

#: Blank rows ruled below the header. A consultant with more snags than this adds
#: rows as usual -- the number is a starting point, not a limit.
TEMPLATE_ROW_COUNT = 50

_FILENAME = "Snag List Template.xlsx"
_SHEET_TITLE = "Snag List"

#: The title line. `{project}` is filled when we know it, dropped when we do not.
_TITLE_WITH_PROJECT = "{project} - SNAG LIST"
_TITLE_PLAIN = "SNAG LIST"

#: The metadata grid under the title: (row offset from the block start, column, label).
#:
#: ⚠️ THESE LABELS AND THIS SHAPE ARE COPIED FROM THE REAL SNAG LISTS THIS FEATURE
#: RECEIVES, and that is a CORRECTNESS decision, not a cosmetic one. `reader.row_is_header`
#: calls a row a header when three or more short text cells sit in it AND any one of them
#: reads as a known header word -- and once a consultant FILLS these lines they carry four
#: non-empty cells, which clears the first half of that test on its own. What keeps them
#: from being mistaken for the header row is only that none of these words is header
#: vocabulary. The real files (header at row 7 and row 10, metadata rows filled with dates,
#: a name and counts) are the evidence that this exact wording is safe; inventing new
#: labels here would be re-rolling that dice with no evidence behind it.
#:
#: Two label/value PAIRS per line, laid out A|B and D|E so they sit under the title like
#: the source documents do.
_META_ROWS = (
    (("Report Start Date", 1, 2), ("Prepared By:", 4, 5)),
    (("Completion Date", 1, 2), ("Total Snags:", 4, 5)),
)

#: Blank spacer rows: one under the subtitle, one above the column headers -- exactly as
#: the source documents separate their three zones.
_SPACER_ROWS = 2

#: 1-based Excel row the column headers land on. DERIVED, never hardcoded -- adding a
#: metadata line moves it, and the builder, the freeze pane and the ruled rows all read
#: this one value. Title + subtitle (2) + metadata + both spacers, then the headers:
#: 2 + 2 + 2 + 1 = ROW 7, which is where the certified fixture puts its header too.
HEADER_ROW = 2 + len(_META_ROWS) + _SPACER_ROWS + 1

# Grey shared by the header row and the Area column, matching the print format's
# table chrome (tailwind gray-200 / gray-300, the app's own palette).
_FILL_HEX = "FFE5E7EB"
_BORDER_HEX = "FFD1D5DB"


@frappe.whitelist()
def download_snag_template(project=None):
    """Return the blank template as an .xlsx download.

    Gated on IMPORT access rather than READ: the template exists to be filled in
    and imported, so the people who may import are exactly the people it is for.

    `project` is OPTIONAL and only ever fills the title block's Project line (and the
    file name). A template asked for without one is still a valid template -- it just
    leaves that line blank for the consultant to write. It is NOT a permission axis:
    the import tier already answered who may have this file at all.
    """
    require_import_access("download the snag list template")

    project_name = None
    if project:
        # `project_name` is the human title; the id is the fallback so a project whose
        # name is somehow blank still labels the sheet with something traceable.
        project_name = frappe.db.get_value("Projects", project, "project_name") or project

    frappe.local.response.filename = _template_filename(project_name)
    frappe.local.response.filecontent = build_template_bytes(project_name=project_name)
    frappe.local.response.type = "download"


def _template_filename(project_name=None):
    """`Snag List Template - <project>.xlsx`, or the bare name with no project.

    The project rides the FILE NAME as well as the title block because a consultant
    working several sites ends up with several of these in one downloads folder, and
    only the file name is visible there.
    """
    if not project_name:
        return _FILENAME
    safe = re.sub(r"[^A-Za-z0-9 _-]", "", project_name).strip()
    return f"Snag List Template - {safe}.xlsx" if safe else _FILENAME


def build_template_bytes(project_name=None) -> bytes:
    """Build the workbook in memory. The only openpyxl touch in this module."""
    import openpyxl  # noqa: PLC0415
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side  # noqa: PLC0415
    from openpyxl.utils import get_column_letter  # noqa: PLC0415

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = _SHEET_TITLE

    grey = PatternFill("solid", fgColor=_FILL_HEX)
    edge = Side(style="thin", color=_BORDER_HEX)
    box = Border(left=edge, right=edge, top=edge, bottom=edge)
    header_font = Font(bold=True)
    area_font = Font(bold=True)
    left_top = Alignment(horizontal="left", vertical="top", wrap_text=True)
    centre_top = Alignment(horizontal="center", vertical="top")

    # --- Title block, modelled on the snag lists this feature receives -----------
    # r1  <PROJECT> - SNAG LIST          (merged, bold)
    # r2  <blank, ruled>                 the consultant's own organisation line
    # r3  (spacer)
    # r4  Report Start Date | ____ | Prepared By: | ____
    # r5  Completion Date   | ____ | Total Snags: | ____
    # r6  (spacer)
    # r7  S.No | Area / Location | Category | Snag Description | Remarks
    width = len(TEMPLATE_HEADERS)

    title = _TITLE_WITH_PROJECT.format(project=project_name) if project_name else _TITLE_PLAIN
    title_cell = sheet.cell(row=1, column=1, value=title)
    title_cell.font = Font(bold=True, size=14)
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=width)

    # The subtitle carries the CONSULTANT's line (their team, their company), so it ships
    # blank and merely ruled. The source documents put their own organisation here; ours
    # would be the wrong name on their document.
    subtitle = sheet.cell(row=2, column=1)
    subtitle.alignment = Alignment(horizontal="left", vertical="center")
    subtitle.border = box
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=width)

    meta_start = 2 + 1 + 1  # title, subtitle, one spacer
    for offset, pairs in enumerate(_META_ROWS):
        row = meta_start + offset
        for label, label_col, value_col in pairs:
            label_cell = sheet.cell(row=row, column=label_col, value=label)
            label_cell.font = header_font
            label_cell.alignment = Alignment(horizontal="left", vertical="center")
            # Ruled so it reads as writable. EMPTY -- every one of these is the
            # consultant's to fill; a value we printed would look like theirs the
            # moment the sheet came back.
            value_cell = sheet.cell(row=row, column=value_col)
            value_cell.border = box
            value_cell.alignment = Alignment(horizontal="left", vertical="center")

    # --- Column headers ---------------------------------------------------------
    for index, label in enumerate(TEMPLATE_HEADERS, start=1):
        cell = sheet.cell(row=HEADER_ROW, column=index, value=label)
        cell.font = header_font
        cell.fill = grey
        cell.border = box
        cell.alignment = Alignment(horizontal="left", vertical="center")

    # The ruled rows carry FORMAT ONLY -- borders, alignment, the Area column's grey.
    # Not one cell is given a value.
    for offset in range(TEMPLATE_ROW_COUNT):
        row = HEADER_ROW + 1 + offset
        for column in range(1, len(TEMPLATE_HEADERS) + 1):
            cell = sheet.cell(row=row, column=column)
            cell.border = box
            cell.alignment = centre_top if column == 1 else left_top
        area = sheet.cell(row=row, column=2)
        area.font = area_font
        area.fill = grey

    for index, width in enumerate(_COLUMN_WIDTHS, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width

    # So the header AND the title block stay put while the consultant types down the
    # sheet -- the freeze moves with `HEADER_ROW` rather than being pinned at "A2".
    sheet.freeze_panes = f"A{HEADER_ROW + 1}"

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
