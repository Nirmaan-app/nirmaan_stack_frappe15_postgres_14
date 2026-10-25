# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The card statement PDF's text, for `card_statement.read_card_statement` (#1566, ADR-0037). No DB.

A password-locked PDF is refused, never opened: the system never asks for or keeps a card password
(spec #1565 story 3). A PDF encrypted with an empty user password (an owner password only) opens without
one, so it is read. Pages are joined with a newline, which is what the reader's fixture holds.
"""

import io

from pypdf import PasswordType, PdfReader
from pypdf.errors import PdfReadError

from nirmaan_stack.services.outflow_import.card_statement import CardStatementError

LOCKED_REFUSAL = "This PDF is password-locked. Unlock it and upload again."


def statement_text(content: bytes) -> str:
    """Every page's text, in page order, or `CardStatementError` for a locked or unreadable file."""
    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted and reader.decrypt("") == PasswordType.NOT_DECRYPTED:
            raise CardStatementError(LOCKED_REFUSAL)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except (PdfReadError, ValueError, TypeError, KeyError) as exc:
        if isinstance(exc, CardStatementError):
            raise
        raise CardStatementError(
            "This file could not be read as a PDF. Upload the card's monthly statement PDF as the bank sends it."
        ) from exc
