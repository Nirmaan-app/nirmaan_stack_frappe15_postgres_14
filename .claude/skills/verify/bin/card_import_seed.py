"""A made-up Credit Card Statement PDF for `walk_card_import.py` (spec #1653): the card fixture
(`services/outflow_import/tests/fixtures/icici_card_statement.txt`, names made up) with a fresh holder and fresh
SerNos each run, so it never repeats an import. Its one unpaired merchant credit is MakeMyTrip ₹801.50.

    devenv.sh script <task> .claude/skills/verify/bin/card_import_seed.py

Prints `holder: <name>` and `statement: <path>` (under the bench's `tmp/`, which the host sees at
`benches/<task>/tmp/`). Writes nothing to the DB.
"""

import os
import random

import frappe

from nirmaan_stack.api.outflow_import.test_card_import import _LINE_START, FIXTURE
from nirmaan_stack.services.outflow_import.tests.card_pdf_builder import pdf_from_text

tag = frappe.generate_hash(length=5).upper()
holder = f"WALK HOLDER {tag}"
base = random.randint(700_000, 799_999) * 10_000
counter = iter(range(1, 1000))
text = FIXTURE.read_text(encoding="utf-8").replace("ARJUN TESTHOLDER", holder)
text = _LINE_START.sub(lambda m: f"{m.group(1)} {base + next(counter):011d} ", text)
path = os.path.abspath(os.path.join(frappe.get_site_path(), "..", "..", "tmp", "walk-card-statement.pdf"))
with open(path, "wb") as handle:
    handle.write(pdf_from_text(text))
print(f"holder: {holder}")
print(f"statement: {path}")
