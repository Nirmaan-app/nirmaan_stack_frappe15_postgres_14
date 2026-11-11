# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Every statement fixture holds made-up people, payees and ids only.

The repository is public, so a fixture cut from a real statement leaks employees', payees' and customers' names and
real transaction ids (spec #1585 shipped one; it was swapped for invented values). These tests read the statement
fixtures under `tests/fixtures/` and refuse any value in a name or id column that is not visibly invented.

A new fixture needs a new name or id? Invent one in the shapes below: a name that starts with "Test", or an invented
person added to `MADE_UP_PEOPLE`. A real person's or payee's name never goes in `MADE_UP_PEOPLE`.

Not covered: free-text columns (bank narrations, remarks) and `icici_card_statement.txt`; review reads those.

Pure: no site, no DB. Run: DEVENV unit nirmaan_stack.services.outflow_import.test_statement_fixtures_made_up
"""

import csv
import io
import re
import unittest
from pathlib import Path

from openpyxl import load_workbook

FIXTURES = Path(__file__).parent / "tests" / "fixtures"

MADE_UP_PEOPLE = {
    # Cashbook spenders
    "Asha Menon", "Ravi Kumar", "Meera Iyer", "MEERA IYER", "Kiran Patil",
    # Porter customers
    "Arjun Pillai", "Kavya Menon", "Meera Shah", "Ravi Testkumar", "Sunil Reddy",
}
# The wallet's own balances, and a public brand named only as a shop.
NOT_A_PERSON = {"Bank", "Virtual Account", "Blinkit"}


def _amount(value: str) -> bool:
    return re.fullmatch(r"-?[\d,]+(\.\d+)?", value) is not None


def _name(value: str) -> bool:
    return value in MADE_UP_PEOPLE or value in NOT_A_PERSON or value.lower().startswith("test") or _amount(value)


def _shape(pattern: str):
    return lambda value: re.fullmatch(pattern, value) is not None


# Per statement kind: its fixture files, a column only its header row has, and a rule per checked column.
KINDS = {
    "cashbook": ("cashbook_*", "Txn Id", {
        "From": _name,
        "To": _name,
        "Reporting Manager": _name,
        "Txn Id": _shape(r"(REF-)?OBO(9|17000)\d+[A-Z0-9]*|PTM9\d+|BUSINESS_USER-9\d{5}-\d|VALOAD-9\d+"),
        "UPI Ref No": _shape(r"9000\d{8}"),
    }),
    "cashfree": ("cashfree_*", "Transfer Id", {
        "Beneficiary Name": _name,
        "Transfer Id": _shape(r"TID0\d+"),
        "IFSC": _shape(r"TEST\d+"),
        "Added by": _shape(r"tester@exampl\S*"),
    }),
    "icici": ("icici_*", "Tran. Id", {
        # The footer's totals sit in this column too.
        "Tran. Id": lambda v: re.fullmatch(r"S[1-9]0{4}\d{3}", v) is not None or _amount(v),
    }),
    "porter": ("porter_*", "crn", {
        "customer_name": lambda v: v.strip() in MADE_UP_PEOPLE,
        "customer_email": _shape(r"[a-z.]+@example\.com"),
        "customer_mobile": _shape(r"900000\d{4}"),
        "crn": _shape(r"CRN9\d+"),
    }),
}


def _rows(path: Path) -> list[list[str]]:
    if path.suffix == ".csv":
        return list(csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig"))))
    book = load_workbook(path, read_only=True)
    try:
        return [["" if v is None else str(v) for v in row] for row in book.active.iter_rows(values_only=True)]
    finally:
        book.close()


def _cells(path: Path, marker: str, column: str):
    """(line number, value) of every non-empty cell under `column`, below each header row holding `marker`."""
    header = None
    for number, row in enumerate(_rows(path), start=1):
        if marker in row and column in row:
            header = row
            continue
        if header is None:
            continue
        index = header.index(column)
        value = row[index].strip() if index < len(row) else ""
        if value:
            yield number, value


class TestStatementFixturesAreMadeUp(unittest.TestCase):
    def test_every_name_and_id_is_invented(self):
        for kind, (pattern, marker, rules) in KINDS.items():
            files = [p for p in sorted(FIXTURES.glob(pattern)) if p.suffix in (".csv", ".xlsx")]
            with self.subTest(kind=kind):
                self.assertTrue(files, f"no {kind} fixtures match {pattern} under {FIXTURES}")
            for path in files:
                for column, invented in rules.items():
                    for line, value in _cells(path, marker, column):
                        with self.subTest(file=path.name, line=line, column=column):
                            self.assertTrue(
                                invented(value),
                                f"{path.name} line {line}, {column}: {value!r} does not look invented. The repo is "
                                "public: use a made-up value (see this module's docstring).",
                            )


if __name__ == "__main__":
    unittest.main()
