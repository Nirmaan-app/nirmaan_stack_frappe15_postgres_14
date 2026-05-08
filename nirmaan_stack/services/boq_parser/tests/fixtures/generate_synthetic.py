"""
Generates synthetic .xlsx fixtures used by test_reader.py.

Run once (or call generate_all() from test setUpClass) to produce:
  - synthetic_simple.xlsx
  - synthetic_merged_header.xlsx
  - synthetic_trailing_spaces.xlsx  (for list_sheets() whitespace test)
  - synthetic_blank_cols.xlsx       (for detect_blank_columns() test)
  - synthetic_empty.xlsx            (for empty-file edge case)
  - synthetic_sparse_header.xlsx    (HVAC-style sparse multi-area header)
  - synthetic_makelist_header.xlsx  (domain-vocab header: "Details of Materials")

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

    # Write empty string to Z1 so openpyxl's max_column extends to 26.
    # The cell is blank (empty string is treated as blank by detect_blank_columns).
    # Column A (index 1) stays blank throughout.
    ws["Z1"] = ""

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
# synthetic_sparse_header.xlsx  (HVAC-style sparse multi-area header)
# ------------------------------------------------------------------

def generate_sparse_header() -> Path:
    """
    HVAC-style sheet with merged area labels above the real header.
    Sheet "HVAC-style":
    Row 1: A1:J1 merged title "HVAC Equipment Schedule — Block A"
    Row 2: empty
    Row 3: C3:D3 merged "Supply Side", E3:F3 merged "Install Side"
           — only 2 non-empty cells after merge; fails ≥3 guard
    Row 4: C4="Qty" D4="Rate" E4="Qty" F4="Rate" G4="Amount"
           — 5 non-empty, no header keywords → score 0
    Row 5: A5="Sl.No." B5="Description" C5="Unit" G5="Total" H5="Remarks"
           — SPARSE HEADER ROW (5 non-empty; scores 4pts)
    Row 6: empty separator
    Row 7: 1.0 | <description >60 chars> | "Nos" | 2 | 1 | ... — DATA
           — last content row; B7 text is >60 chars
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "HVAC-style"

    # Row 1 — merged title
    ws["A1"] = "HVAC Equipment Schedule — Block A"
    ws.merge_cells("A1:J1")

    # Row 3 — area headers (only 2 non-empty after merge → fails Guard 1)
    ws["C3"] = "Supply Side"
    ws.merge_cells("C3:D3")
    ws["E3"] = "Install Side"
    ws.merge_cells("E3:F3")

    # Row 4 — sub-labels (5 non-empty, no keywords → score 0)
    ws["C4"] = "Qty"
    ws["D4"] = "Rate"
    ws["E4"] = "Qty"
    ws["F4"] = "Rate"
    ws["G4"] = "Amount"

    # Row 5 — sparse column headers (HEADER ROW; scores 4pts via sl.no + description)
    ws["A5"] = "Sl.No."
    ws["B5"] = "Description"
    ws["C5"] = "Unit"
    ws["G5"] = "Total"
    ws["H5"] = "Remarks"

    # Row 7 — first data row; B7 is >60 chars (tests long-text guard)
    ws["A7"] = 1.0
    ws["B7"] = (
        "Supply and installation of split AC 2 Ton capacity unit "
        "with outdoor condensing unit fully integrated"
    )
    ws["C7"] = "Nos"
    ws["D7"] = 2
    ws["E7"] = 1
    ws["G7"] = 3
    ws["H7"] = "As per spec"

    path = _path("synthetic_sparse_header.xlsx")
    wb.save(str(path))
    return path


# ------------------------------------------------------------------
# synthetic_makelist_header.xlsx  (domain-vocab header)
# ------------------------------------------------------------------

def generate_makelist_header() -> Path:
    """
    Domain-vocabulary column headers: "Details of Materials", "Approved Makes".
    Sheet "Make List":
    Row 1: A1:F1 merged "Substation Equipment Make List"  (1 non-empty → fails Guard 1)
    Row 2: empty
    Row 3: "Sr.No." | "Details of Materials" | "Approved Makes" | "Unit" | "Qty" | "Rate"
           — HEADER ROW (scores 4pts: sr.no=2, details of materials=1, approved makes=1)
    Row 4: 1.0 | "Main Breaker 400A" | "ABB / Schneider" | "Nos" | 2 | 15000
    Row 5: 2.0 | "Bus Bar 60x10 copper" | "Hindalco" | "Meter" | 10 | 800
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Make List"

    # Row 1 — merged title
    ws["A1"] = "Substation Equipment Make List"
    ws.merge_cells("A1:F1")

    # Row 3 — column headers with domain vocabulary (HEADER ROW)
    ws["A3"] = "Sr.No."
    ws["B3"] = "Details of Materials"
    ws["C3"] = "Approved Makes"
    ws["D3"] = "Unit"
    ws["E3"] = "Qty"
    ws["F3"] = "Rate"

    # Row 4 — data
    ws["A4"] = 1.0
    ws["B4"] = "Main Breaker 400A"
    ws["C4"] = "ABB / Schneider"
    ws["D4"] = "Nos"
    ws["E4"] = 2
    ws["F4"] = 15000

    # Row 5 — data
    ws["A5"] = 2.0
    ws["B5"] = "Bus Bar 60x10 copper"
    ws["C5"] = "Hindalco"
    ws["D5"] = "Meter"
    ws["E5"] = 10
    ws["F5"] = 800

    path = _path("synthetic_makelist_header.xlsx")
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
    generate_sparse_header()
    generate_makelist_header()


if __name__ == "__main__":
    generate_all()
    print("Fixtures generated in", _HERE)
