# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Each role list the screens show a control by matches the server's list that enforces it (spec #1528
review, D2), the way `test_work_order_lifecycle` pins the Finalize banner to its server text.

The server sets (`services/role_profiles`) are the enforcement boundary; the frontend copies only decide
whether a control renders. A copy that drifts shows a button the server refuses, or hides one it allows.
This reads the TypeScript source: a list is `export const NAME ... = [ ... ];`, its entries string literals,
string constants of `constants/roles.ts` (or the same file), or `...SPREAD` of such a list.

Run: DEVENV test --module nirmaan_stack.services.test_role_mirrors
"""

import re
import unittest
from pathlib import Path

from nirmaan_stack.services import amount_paid_drift, role_profiles

FRONTEND = Path(__file__).resolve().parents[2] / "frontend/src"
ROLES_TS = FRONTEND / "constants/roles.ts"


def _source(path: Path) -> str:
    return path.read_text()


def _string_const(name: str, sources: list[str]) -> str | None:
    for text in sources:
        m = re.search(rf'\bconst {name}\s*(?::\s*string\s*)?=\s*"([^"]+)"', text)
        if m:
            return m.group(1)
    return None


def _list(name: str, sources: list[str]) -> list[str]:
    for text in sources:
        m = re.search(rf"\bconst {name}\b[^=]*=\s*\[(.*?)\]", text, re.S)
        if m:
            return _entries(m.group(1), sources)
    raise AssertionError(f"no list {name} in the frontend source")


def _entries(body: str, sources: list[str]) -> list[str]:
    values = []
    body = re.sub(r"//[^\n]*", "", body)
    for raw in body.split(","):
        token = raw.strip()
        if not token:
            continue
        if token.startswith('"'):
            values.append(token.strip('"'))
        elif token.startswith("..."):
            values.extend(_list(token[3:], sources))
        elif "." in token:  # PAYMENT_STATUS.PAID and the like: not a role
            raise AssertionError(f"unreadable entry {token}")
        else:
            value = _string_const(token, sources)
            if value is None:
                raise AssertionError(f"no string constant {token}")
            values.append(value)
    return values


def frontend_list(name: str, file: Path = ROLES_TS) -> set[str]:
    sources = [_source(file)] if file == ROLES_TS else [_source(file), _source(ROLES_TS)]
    return set(_list(name, sources))


class TheScreensShowWhatTheServerAllows(unittest.TestCase):
    def test_each_role_list_matches_its_server_twin(self):
        pairs = (
            ("WO_GENERATED_INVOICE_PROFILES", ROLES_TS, role_profiles.WO_GENERATED_INVOICE_PROFILES),
            ("MATCH_GST_TO_VENDOR_PROFILES", ROLES_TS, role_profiles.MATCH_GST_TO_VENDOR_PROFILES),
            ("WO_INVOICE_EDIT_PROFILES", ROLES_TS, role_profiles.WO_INVOICE_EDIT_PROFILES),
            ("PAYMENT_L1_PROFILES", ROLES_TS, role_profiles.PAYMENT_L1_PROFILES),
            ("ACCOUNTANT_PROFILES", ROLES_TS, role_profiles.ACCOUNTANT_PROFILES),
            ("REPORTS_BULK_DOWNLOAD_PROFILES", ROLES_TS, role_profiles.REPORTS_BULK_DOWNLOAD_PROFILES),
            ("SR_ADMIN_ROLES", FRONTEND / "pages/ServiceRequests/config/srTabs.constants.ts",
             role_profiles.WO_DECIDE_PROFILES),
        )
        for name, file, server in pairs:
            with self.subTest(name=name):
                self.assertEqual(frontend_list(name, file), set(server))

    def test_the_payments_tabs_approve_by_the_l1_list(self):
        """`canApprove` reads `PAYMENT_L1_PROFILES`, the list pinned above, not a profile of its own."""
        text = _source(FRONTEND / "pages/ProjectPayments/config/paymentsTabSet.ts")
        self.assertRegex(text, r"const canApprove: Rule = .*PAYMENT_L1_PROFILES\.includes")

    def test_the_payments_pop_up_warns_at_the_mismatch_reports_threshold(self):
        text = _source(FRONTEND / "pages/ProjectPayments/paymentsDialogRows.ts")
        m = re.search(r"export const AMOUNT_PAID_DRIFT_THRESHOLD = ([\d.]+);", text)
        self.assertEqual(float(m.group(1)), amount_paid_drift.THRESHOLD)

    def test_reports_bulk_download_caps_a_selection_at_the_servers_limit(self):
        """The browser disables Download above `ALL_SCOPE_MAX_ITEMS`; the server refuses above its own. They agree."""
        from nirmaan_stack.api.pdf_helper import bulk_download

        text = _source(FRONTEND / "utils/bulkDownload/bulkDownloadTypes.ts")
        m = re.search(r"export const ALL_SCOPE_MAX_ITEMS = (\d+);", text)
        self.assertEqual(int(m.group(1)), bulk_download.ALL_SCOPE_MAX_ITEMS)
