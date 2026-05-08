"""
Generates synthetic .xlsx fixtures used by test_reader.py.

Run once (or call generate_all() from test setUpClass) to produce:
  - synthetic_simple.xlsx
  - synthetic_merged_header.xlsx
  - synthetic_trailing_spaces.xlsx  (for list_sheets() whitespace test)
  - synthetic_blank_cols.xlsx       (for detect_blank_columns() test)
  - synthetic_empty.xlsx            (for empty-file edge case)

All files are written into this same directory so tests can find them
via: Path(__file__).parent / "<name>.xlsx"
"""
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill

_HERE = Path(__file__).parent


def _path(name: str) -> Path:
    return _HERE / name


# ------------------------------------------------------------------
# synthetic_simple.xlsx
# ------------------------------------------------------------------

def generate_simple() -> Path:
    """
    Single sheet "Sheet1":
    Row 1: headers — Sl.No. | Description | Unit | Qty | Rate | Amount
    Row 2: 1.0 | First item | Nos | 5 | 100 | 500   (pre-computed; also stores formula text as metadata)
    Row 3: 2.0 | Second item | Nos | 3 | 200 | 600
    Row 4: empty
    Row 5: 3.0 | Bold item | Nos | 2 | 50 | 100   — column B cell is bold
    Row 6: empty (spacer)

    NOTE: openpyxl cannot cache formula results (that requires Excel/LibreOffice
    to evaluate the workbook).  We therefore write COMPUTED VALUES directly into
    column F so data_only=True reads the correct numbers.  Row 2 column F ALSO
    stores a formula string in a *separate* cell (G2) to let us test formula
    detection without needing Excel to evaluate it.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    # Row 1 — headers
    ws["A1"] = "Sl.No."
    ws["B1"] = "Description"
    ws["C1"] = "Unit"
    ws["D1"] = "Qty"
    ws["E1"] = "Rate"
    ws["F1"] = "Amount"
    ws["G1"] = "Formula (test)"

    # Row 2 — normal item; F2 = pre-computed value, G2 = formula string for detection
    ws["A2"] = 1.0
    ws["B2"] = "First item"
    ws["C2"] = "Nos"
    ws["D2"] = 5
    ws["E2"] = 100
    ws["F2"] = 500          # pre-computed so data_only=True returns 500
    ws["G2"] = "=D2*E2"     # raw formula string — used to test is_formula detection

    # Row 3
    ws["A3"] = 2.0
    ws["B3"] = "Second item"
    ws["C3"] = "Nos"
    ws["D3"] = 3
    ws["E3"] = 200
    ws["F3"] = 600

    # Row 4 — empty
    # (no writes needed)

    # Row 5 — bold description
    ws["A5"] = 3.0
    ws["B5"] = "Bold item"
    ws["B5"].font = Font(bold=True)
    ws["C5"] = "Nos"
    ws["D5"] = 2
    ws["E5"] = 50
    ws["F5"] = 100

    # Row 6 — empty spacer (no writes)

    path = _path("synthetic_simple.xlsx")
    wb.save(str(path))
    return path


# ------------------------------------------------------------------
# synthetic_merged_header.xlsx
# ------------------------------------------------------------------

def generate_merged_header() -> Path:
    """
    Single sheet "Data":
    Rows 1-2: A1:F1 merged title "Project XYZ — BoQ"  (actually spans row 1)
    Row 3-4:  merged column headers
      A3:A4 = "Sl.No.", B3:B4 = "Description", C3:C4 = "Unit",
      D3:D4 = "Qty", E3:F3 = "Rate" (with E4="Supply", F4="Install")
    Row 5: data — 1.0 | Item one | Nos | 5 | 100 | 50
    Row 6: data — 2.0 | Item two | Nos | 3 | 200 | 0
    Row 7: "Total" in col A only (label-only row)
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Data"

    # Title spanning row 1
    ws["A1"] = "Project XYZ — BoQ"
    ws.merge_cells("A1:F1")

    # Merged column headers
    ws["A3"] = "Sl.No."
    ws.merge_cells("A3:A4")

    ws["B3"] = "Description"
    ws.merge_cells("B3:B4")

    ws["C3"] = "Unit"
    ws.merge_cells("C3:C4")

    ws["D3"] = "Qty"
    ws.merge_cells("D3:D4")

    ws["E3"] = "Rate"
    ws.merge_cells("E3:F3")
    ws["E4"] = "Supply"
    ws["F4"] = "Install"

    # Data rows
    ws["A5"] = 1.0
    ws["B5"] = "Item one"
    ws["C5"] = "Nos"
    ws["D5"] = 5
    ws["E5"] = 100
    ws["F5"] = 50

    ws["A6"] = 2.0
    ws["B6"] = "Item two"
    ws["C6"] = "Nos"
    ws["D6"] = 3
    ws["E6"] = 200
    ws["F6"] = 0

    # Label-only row
    ws["A7"] = "Total"

    path = _path("synthetic_merged_header.xlsx")
    wb.save(str(path))
    return path


# ------------------------------------------------------------------
# synthetic_trailing_spaces.xlsx  (two sheets, one has trailing spaces)
# ------------------------------------------------------------------

def generate_trailing_spaces() -> Path:
    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "Sheet One"
    ws1["A1"] = "data"

    ws2 = wb.create_sheet("Trailing  ")   # two trailing spaces
    ws2["A1"] = "data"

    path = _path("synthetic_trailing_spaces.xlsx")
    wb.save(str(path))
    return path


# ------------------------------------------------------------------
# synthetic_blank_cols.xlsx  (cols A and Z blank, B-D have content)
# ------------------------------------------------------------------

def generate_blank_cols() -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    # Columns B, C, D have content in several rows
    for row in range(1, 6):
        ws.cell(row=row, column=2).value = f"B{row}"   # col B
        ws.cell(row=row, column=3).value = f"C{row}"   # col C
        ws.cell(row=row, column=4).value = f"D{row}"   # col D
        # col Z (index 26) stays blank; col A (index 1) stays blank

    path = _path("synthetic_blank_cols.xlsx")
    wb.save(str(path))
    return path


# ------------------------------------------------------------------
# synthetic_empty.xlsx
# ------------------------------------------------------------------

def generate_empty() -> Path:
    wb = openpyxl.Workbook()
    wb.active.title = "Empty"
    path = _path("synthetic_empty.xlsx")
    wb.save(str(path))
    return path


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------

def generate_all() -> None:
    generate_simple()
    generate_merged_header()
    generate_trailing_spaces()
    generate_blank_cols()
    generate_empty()


if __name__ == "__main__":
    generate_all()
    print("Fixtures generated in", _HERE)
