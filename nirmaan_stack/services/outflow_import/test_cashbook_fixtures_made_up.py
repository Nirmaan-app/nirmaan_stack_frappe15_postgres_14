# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Every Cashbook test statement holds made-up people, payees and ids only.

The repository is public, so a fixture copied from a real wallet statement leaks employees' and payees' names
and real transaction ids (spec #1585 shipped one; it was swapped for invented values). These tests read every
`tests/fixtures/cashbook_*` file and refuse any name or id that is not visibly invented.

A new fixture needs a new name? Invent one: start it with "Test", or add an invented person to `MADE_UP_PEOPLE`.
Never add a real person's or payee's name here.

Pure: no site, no DB. Run: DEVENV unit nirmaan_stack.services.outflow_import.test_cashbook_fixtures_made_up
"""

import csv
import io
import re
import unittest
from pathlib import Path

from openpyxl import load_workbook

FIXTURES = Path(__file__).parent / "tests" / "fixtures"

MADE_UP_PEOPLE = {"Asha Menon", "Ravi Kumar", "Meera Iyer", "MEERA IYER", "Kiran Patil"}
# The wallet's own balances, and a public brand named only as a shop.
NOT_A_PERSON = {"Bank", "Virtual Account", "Blinkit"}
MADE_UP_ID = re.compile(
    r"(REF-)?OBO(9|17000)\d+[A-Z0-9]*|PTM9\d+|BUSINESS_USER-9\d{5}-\d|VALOAD-9\d+"
)
MADE_UP_UPI_REF = re.compile(r"9000\d{8}")


def _rows(path: Path) -> list[list[str]]:
    if path.suffix == ".csv":
        return list(csv.reader(io.StringIO(path.read_text(encoding="utf-8-sig"))))
    book = load_workbook(path, read_only=True)
    try:
        return [["" if v is None else str(v) for v in row] for row in book.active.iter_rows(values_only=True)]
    finally:
        book.close()


def _cells(path: Path, column: str):
    """(line number, value) of every non-empty cell under `column`, in every table of `path`."""
    header = None
    for number, row in enumerate(_rows(path), start=1):
        if column in row and "Txn Id" in row:
            header = row
            continue
        if header is None:
            continue
        index = header.index(column)
        value = row[index].strip() if index < len(row) else ""
        if value:
            yield number, value


def _is_amount(value: str) -> bool:
    return re.fullmatch(r"-?[\d,]+(\.\d+)?", value) is not None


class TestCashbookFixturesAreMadeUp(unittest.TestCase):
    def setUp(self):
        self.files = sorted(FIXTURES.glob("cashbook_*.csv")) + sorted(FIXTURES.glob("cashbook_*.xlsx"))
        self.assertTrue(self.files, f"no Cashbook fixtures under {FIXTURES}")

    def test_every_person_and_payee_is_invented(self):
        for path in self.files:
            for column in ("From", "To", "Reporting Manager"):
                for line, value in _cells(path, column):
                    invented = (
                        value in MADE_UP_PEOPLE
                        or value in NOT_A_PERSON
                        or value.lower().startswith("test")
                        or _is_amount(value)
                    )
                    with self.subTest(file=path.name, line=line, column=column):
                        self.assertTrue(
                            invented,
                            f"{path.name} line {line}, {column}: {value!r} is not a made-up name. The repo is "
                            "public: invent one (start it with 'Test', or add an invented person to "
                            "MADE_UP_PEOPLE).",
                        )

    def test_every_transaction_id_is_invented(self):
        for path in self.files:
            for line, value in _cells(path, "Txn Id"):
                with self.subTest(file=path.name, line=line):
                    self.assertRegex(value, f"^(?:{MADE_UP_ID.pattern})$", f"{path.name} line {line}: real Txn Id?")
            for line, value in _cells(path, "UPI Ref No"):
                with self.subTest(file=path.name, line=line, column="UPI Ref No"):
                    self.assertRegex(value, f"^(?:{MADE_UP_UPI_REF.pattern})$", f"{path.name} line {line}: real UPI ref?")


if __name__ == "__main__":
    unittest.main()
