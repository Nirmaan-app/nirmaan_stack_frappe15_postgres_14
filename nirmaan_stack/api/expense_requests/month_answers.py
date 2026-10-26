# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A request form's month answers: a month and year, `YYYY-MM`, or refused (spec #1522 review batch 2).

A format field of type `month` (Office Rent's Rent Month, owner 2026-10-21) asks for a month and its
year, never a day. The dialog draws it as a month picker (`<input type="month">`, whose value is
`YYYY-MM`) and checks it before submit (`frontend/src/utils/expenseFormat.monthAnswerProblem`);
`create.guard_month_answers` applies this rule when a request is raised or edited. The sentence reads
it as `Oct 2026` (`flatten._prose_value`), and so does the request page (`expenseFormat.showAnswer`).

A month left blank is not checked here: a form's required answers are the dialog's to enforce
(`create.guard_request_form`).

PURE: no `frappe`, no DB.
"""

from nirmaan_stack.api.expense_requests.flatten import ISO_MONTH, as_dict, fields_of_type

MONTH_FIELD_TYPE = "month"


def is_month(value) -> bool:
    """`YYYY-MM`, with a month from 01 to 12."""
    return isinstance(value, str) and bool(ISO_MONTH.fullmatch(value.strip()))


def month_problem(label: str, value) -> str:
    return f'{label} "{value}" is not a month. Pick the month and year, like 2026-10.'


def month_problems(source_data, source_format) -> list[str]:
    """One message per `month` answer that is not a month and year; `[]` when every one is, or none was given."""
    fields = fields_of_type(source_format, MONTH_FIELD_TYPE)
    responses = (as_dict(source_data) or {}).get("responses")
    if not fields or not isinstance(responses, dict):
        return []
    problems = []
    for section_id, key, label in fields:
        section = responses.get(section_id)
        value = section.get(key) if isinstance(section, dict) else None
        if str(value or "").strip() and not is_month(value):
            problems.append(month_problem(label, value))
    return problems
