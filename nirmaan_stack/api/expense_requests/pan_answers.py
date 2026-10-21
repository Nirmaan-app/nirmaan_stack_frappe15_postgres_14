# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A request form's PAN answers: uppercased, and refused unless shaped like a PAN (spec #1522, #1524).

A format field of type `pan` (Office Rent's Landlord PAN) asks for an Income Tax PAN. Its rule is
the vendor PAN's one rule (`services/vendor_tds.is_valid_pan`, `clean_pan`): ten characters, five
letters, four digits and a letter, like ABCPK1234D. `create.guard_pan_answers` applies it when a
request is raised or edited; the dialog applies the same rule before submit
(`frontend/src/utils/expenseFormat.panAnswerProblem`, over `utils/pan`).

A PAN left blank is not checked here. A form's required answers are the dialog's to enforce, like
every other required answer (`create.guard_request_form`), with one exception: Office Rent's landlord
name and PAN, which `create.guard_deductee_answers` requires (spec #1522 review).

PURE: no `frappe`, no DB.
"""

import json

from nirmaan_stack.api.expense_requests.flatten import as_dict
from nirmaan_stack.services.vendor_tds import clean_pan, is_valid_pan

PAN_FIELD_TYPE = "pan"


def pan_fields(source_format) -> list[tuple[str, str, str]]:
    """`(section id, field key, label)` for every `pan` field of a format."""
    out = []
    for section in (as_dict(source_format) or {}).get("sections") or []:
        if not isinstance(section, dict):
            continue
        for f in section.get("fields") or []:
            if isinstance(f, dict) and f.get("key") and f.get("type") == PAN_FIELD_TYPE:
                out.append((section.get("id"), f["key"], f.get("label") or f["key"]))
    return out


def pan_problem(label: str, value) -> str:
    return (f'{label} "{value}" is not a PAN. A PAN is 10 characters: 5 letters, 4 digits '
            "and a letter, like ABCPK1234D.")


def clean_pan_answers(source_data, source_format) -> tuple[str | None, list[str]]:
    """`source_data` with every PAN answer uppercased, and one message per answer that is not a PAN.

    `source_data` comes back unchanged when the form asks no PAN or none was answered.
    """
    fields = pan_fields(source_format)
    data = as_dict(source_data)
    responses = (data or {}).get("responses")
    if not fields or not isinstance(responses, dict):
        return source_data, []

    problems = []
    changed = False
    for section_id, key, label in fields:
        section = responses.get(section_id)
        if not isinstance(section, dict) or not str(section.get(key) or "").strip():
            continue
        value = clean_pan(section[key])
        if not is_valid_pan(value):
            problems.append(pan_problem(label, section[key]))
            continue
        if value != section[key]:
            section[key] = value
            changed = True
    return (json.dumps(data) if changed else source_data), problems
