# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Test support: a Cashbook CSV fixture as the workbook the wallet provider exports (spec #1585 code review S4).

The Cashbook upload takes only the Cashbook Statement as downloaded, an .xlsx whose bill links are cell hyperlinks
under "View Attachment N". Several tests build their statement as CSV text, line by line, because that is the
readable way to vary one line; `as_statement_xlsx` turns such text into the workbook the endpoints accept. A cell
holding a URL becomes "View Attachment N" with the URL as its hyperlink, numbered within its row, exactly as the
provider writes it; every other cell keeps its text.
"""

from __future__ import annotations

import csv
import io

from openpyxl import Workbook


def as_statement_xlsx(content: bytes) -> bytes:
    """`content` (a Cashbook statement as CSV text) as the provider's .xlsx."""
    book = Workbook()
    sheet = book.active
    sheet.title = "TransactionsReport"
    for row_number, row in enumerate(csv.reader(io.StringIO(content.decode("utf-8-sig"))), start=1):
        attachment = 0
        for column_number, text in enumerate(row, start=1):
            cell = sheet.cell(row=row_number, column=column_number)
            if text.strip().lower().startswith(("https://", "http://")):
                attachment += 1
                cell.value = f"View Attachment {attachment}"
                cell.hyperlink = text.strip()
            elif text != "":
                cell.value = text
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()
