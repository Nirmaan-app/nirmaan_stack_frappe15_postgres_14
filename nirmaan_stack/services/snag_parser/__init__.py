"""Snag List parser — PURE (openpyxl + stdlib only).

Reads a Snag List workbook from a filesystem PATH and returns plain dicts
matching the wire contract in `frontend/src/pages/SnagList/types.ts`.

NOTHING in this package imports frappe, touches the database or reads request
context: the API layer (`nirmaan_stack/api/snags/`) owns the file handling, the
duplicate lookup and every write. That is what makes this package unit-testable
with no bench context (root CLAUDE.md § Testing Conventions).

    from nirmaan_stack.services.snag_parser import inspect_workbook, guess_mapping, parse_sheet

    sheets = inspect_workbook("/tmp/snags.xlsx")           # -> WorkbookSheet[]
    preview = parse_sheet("/tmp/snags.xlsx", "Sheet1", sheets[0]["mapping_guess"])
"""

from .guess import ROLE_ORDER, ROLE_SYNONYMS, guess_mapping
from .parser import (
    SKIP_ABOVE_HEADER,
    SKIP_BLANK,
    SKIP_NO_DESCRIPTION,
    SKIP_REPEATED_HEADER,
    SKIP_SUMMARY_BLOCK,
    parse_grid,
    parse_sheet,
)
from .reader import columns_for_header_row, find_header_row, inspect_sheet, inspect_workbook

__all__ = [
    "ROLE_ORDER",
    "ROLE_SYNONYMS",
    "SKIP_ABOVE_HEADER",
    "SKIP_BLANK",
    "SKIP_NO_DESCRIPTION",
    "SKIP_REPEATED_HEADER",
    "SKIP_SUMMARY_BLOCK",
    "columns_for_header_row",
    "find_header_row",
    "guess_mapping",
    "inspect_sheet",
    "inspect_workbook",
    "parse_grid",
    "parse_sheet",
]
