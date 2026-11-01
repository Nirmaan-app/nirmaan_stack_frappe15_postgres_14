# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The card statement PDF's text, for `card_statement.read_card_statement` (#1566, ADR-0039). No DB.

A password-locked PDF is opened with the password the accountant types on Upload (ADR-0039 Amendment A),
and refused without it, or with a wrong one. The password is used here, in memory, and nowhere else: it
is never saved, logged or returned. What is stored is `unlocked_copy`, the same PDF with no password, so
the statement opens for anyone who may open it. A PDF encrypted with an empty user password (an owner
password only) opens without one. Pages are joined with a newline, which is what the reader's fixture holds.

⚠️ THE TWO PASSWORD REFUSALS ARE PINNED WORD FOR WORD ON THE SCREEN (`creditCardImport.ts`,
`CARD_PASSWORD_REFUSALS`): either one is what makes Upload show the password field. Change them together.
"""

import io

from pypdf import PasswordType, PdfReader, PdfWriter
from pypdf.errors import PdfReadError

from nirmaan_stack.services.outflow_import.card_statement import CardStatementError

PASSWORD_NEEDED = "This PDF is password-locked. Enter its password and upload again."
WRONG_PASSWORD = "That password did not open this PDF. Check it and upload again."


def _open(content: bytes, password: str) -> PdfReader:
    """The PDF, decrypted if it is encrypted, or `CardStatementError` for a locked or unreadable file."""
    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted and not _decrypts(reader, password):
            raise CardStatementError(WRONG_PASSWORD if password else PASSWORD_NEEDED)
        return reader
    except (PdfReadError, ValueError, TypeError, KeyError) as exc:
        if isinstance(exc, CardStatementError):
            raise
        raise CardStatementError(
            "This file could not be read as a PDF. Upload the card's monthly statement PDF as the bank sends it."
        ) from exc


def _decrypts(reader: PdfReader, password: str) -> bool:
    """The empty password first (an owner-password-only PDF opens without one, whatever was typed), then
    the one typed."""
    return any(reader.decrypt(attempt) != PasswordType.NOT_DECRYPTED for attempt in dict.fromkeys(("", password)))


def statement_text(content: bytes, password: str = "") -> str:
    """Every page's text, in page order, or `CardStatementError` for a locked or unreadable file."""
    reader = _open(content, password)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def unlocked_copy(content: bytes, password: str = "") -> bytes:
    """The bytes to store: the upload itself when it is not encrypted, else the same PDF written again with
    no encryption, so the stored statement opens without a password."""
    reader = _open(content, password)
    if not reader.is_encrypted:
        return content
    out = io.BytesIO()
    PdfWriter(clone_from=reader).write(out)
    return out.getvalue()
