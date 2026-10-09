# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for ai_settings.py (Slice AI-2a).

Covers the two reader helpers + the encryption-at-rest invariant on the key field:
  T1 get_boq_ai_api_key -> None when no key is set (fail-closed)
  T2 get_boq_ai_settings -> fail-closed default shape on an unset Single
  T3 get_boq_ai_settings -> reflects non-secret fields once set
  T4 anthropic_api_key field is fieldtype "Password" (encrypted at rest)
  T5 no test anywhere passes the key VALUE to an assertion (it would print on failure)

No API key value appears anywhere in this file -- the secret is entered manually
via the Frappe UI after this lands.
"""
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.ai_settings import (
    SETTINGS_DOCTYPE,
    get_boq_ai_api_key,
    get_boq_ai_settings,
)


class TestAISettings(FrappeTestCase):

    def test_get_boq_ai_api_key_returns_none_when_unset(self):
        """No key configured -> the decrypted read fails closed to None.

        ⚠️ THE VALUE IS NEVER PASSED TO AN ASSERTION, AND THAT IS THE POINT (owner, 2026-10-04).
        `assertIsNone(get_boq_ai_api_key())` prints the ACTUAL on failure -- so on a site that HAS a key
        configured, this test wrote a live Anthropic secret verbatim into the test output, and from there
        into every CI log, run log and triage file that captured it. A test that reads a secret must assert
        on a DERIVED FACT about it, never on the secret itself: here, the one bit that is actually under
        test is "set" vs "unset", so that is all that is compared and all a failure can reveal.

        ⚠️ AND THE UNSET STATE IS NOW SUPPLIED, NOT HOPED FOR (slice 12c-T, item 6). The assertion was
        a statement about THE SITE, so on the owner's own site -- which has a key configured -- it
        failed for a reason that has nothing to do with the code. What is under test is the READER's
        fail-closed behaviour, so the absence is injected at the one seam the reader uses
        (`frappe.utils.password.get_decrypted_password`, imported inside the function) and the real
        stored secret is NEVER READ, never written and never restored -- there is nothing to restore,
        because the setting is untouched. That is strictly safer than capture-and-restore here: a
        capture would have to read the key.
        """
        with patch("frappe.utils.password.get_decrypted_password", return_value=None):
            state = "unset" if get_boq_ai_api_key() is None else "set"
        self.assertEqual(state, "unset",
                         "an unset Anthropic key must read back as None (fail-closed); "
                         "the key reads as SET on this site")

    def test_get_boq_ai_api_key_reads_as_set_when_one_is_stored(self):
        """NEGATIVE half of the above (slice 12c-T): the reader is not simply always None.

        Without this, patching the seam to None would make the positive test vacuous -- it would pass
        against a reader that had been broken to return None unconditionally. The stand-in value is a
        literal in this file and is NOT a credential; the real stored key is never read.

        ⚠️ EVERY ASSERTION BELOW TAKES A LOCAL OR A DERIVED BOOLEAN, NEVER THE GETTER'S RESULT, AND
        THE T5 PIN CAUGHT THE FIRST DRAFT OF THIS VERY TEST DOING OTHERWISE. The rule is absolute on
        purpose -- it carves out no exception for "the value here is a harmless stand-in", because
        the next person to copy the shape will not be inside a patch. So the value is read into a
        local and only comparisons are asserted: a failure can print True/False and nothing else.
        """
        with patch("frappe.utils.password.get_decrypted_password", return_value="  not-a-real-key  "):
            got = get_boq_ai_api_key()
        self.assertEqual("unset" if got is None else "set", "set")
        # and it is stripped -- the reader's own contract
        self.assertEqual(got == "not-a-real-key", True, "the reader must strip surrounding whitespace")
        # whitespace only is still UNSET (fail-closed), not a key made of spaces
        with patch("frappe.utils.password.get_decrypted_password", return_value="   "):
            blank = get_boq_ai_api_key()
        self.assertEqual("unset" if blank is None else "set", "unset")

    def test_get_boq_ai_settings_defaults(self):
        """On an unset Single the settings reader returns the fail-closed shape:
        enabled False + request_timeout_seconds present.

        ⚠️ THE UNSET SINGLE IS SET UP AND RESTORED HERE (slice 12c-T, item 6). This asserted
        `enabled is False` against WHATEVER the live site happened to hold, and the owner's site has
        the AI pass switched ON -- so it failed on a true setting, not a defect. The two fields the
        assertion reads are therefore blanked for the duration and the site's ORIGINAL values are put
        back.

        ⚠️ PER THE STANDING SINGLE-DOCTYPE RULE: the originals are CAPTURED and those are what get
        restored -- never a hardcoded constant. `set_single_value` bypasses the doc lifecycle and
        writes NO Version row, so a hardcoded restore would silently rewrite the owner's real setting
        and no audit could see it.
        """
        orig_enabled = frappe.db.get_single_value(SETTINGS_DOCTYPE, "enabled")
        orig_timeout = frappe.db.get_single_value(SETTINGS_DOCTYPE, "request_timeout_seconds")

        def _restore():
            frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", orig_enabled)
            frappe.db.set_single_value(SETTINGS_DOCTYPE, "request_timeout_seconds", orig_timeout)

        self.addCleanup(_restore)
        frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", None)
        frappe.db.set_single_value(SETTINGS_DOCTYPE, "request_timeout_seconds", None)

        settings = get_boq_ai_settings()
        self.assertIsInstance(settings, dict)
        self.assertFalse(settings["enabled"], "enabled must default to False")
        self.assertIn("request_timeout_seconds", settings,
                      "request_timeout_seconds must always be present")
        self.assertEqual(settings["request_timeout_seconds"], 120,
                         "an unset timeout must fall back to the fail-closed 120s")

    def test_get_boq_ai_settings_reads_non_secret_fields(self):
        """Setting non-secret fields is reflected by the reader."""
        orig_enabled = frappe.db.get_single_value(SETTINGS_DOCTYPE, "enabled")
        orig_model = frappe.db.get_single_value(SETTINGS_DOCTYPE, "model")

        def _restore():
            frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", orig_enabled)
            frappe.db.set_single_value(SETTINGS_DOCTYPE, "model", orig_model)

        self.addCleanup(_restore)

        frappe.db.set_single_value(SETTINGS_DOCTYPE, "enabled", 1)
        frappe.db.set_single_value(SETTINGS_DOCTYPE, "model", "test-model-x")

        settings = get_boq_ai_settings()
        self.assertTrue(settings["enabled"], "enabled=1 must read back True")
        self.assertEqual(settings["model"], "test-model-x",
                         "model must reflect the stored value")

    def test_api_key_field_is_password_type(self):
        """Encryption-at-rest invariant: the key field MUST be a Password field,
        never a plaintext Data field."""
        field = frappe.get_meta(SETTINGS_DOCTYPE).get_field("anthropic_api_key")
        self.assertIsNotNone(field, "anthropic_api_key field must exist")
        self.assertEqual(field.fieldtype, "Password",
                         "anthropic_api_key must be a Password field (encrypted at rest)")

    def test_no_test_passes_a_secret_value_to_an_assertion(self):
        """T5 -- SECURITY PIN (owner, 2026-10-04): a failing assertion PRINTS ITS ACTUAL.

        `assertIsNone(get_boq_ai_api_key())` therefore wrote a live Anthropic key verbatim into the test
        output on any site that had one configured -- and from there into every log that captured the run.
        The fix is to assert on a DERIVED FACT ("set" / "unset"), never on the secret. This pin keeps it
        that way: no test file may hand the key getter's RESULT straight to an assertion.

        Search space, stated: every `test_*.py` under `nirmaan_stack/`. The pattern looked for is the
        getter called INSIDE an assert call on one line, which is exactly the retired shape.
        """
        import os, re
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        bad, scanned = [], 0
        # a STATEMENT, not prose: the line must START with the assert call. Without this the pin
        # trips on its own docstrings, which quote the retired shape in order to explain it.
        rx = re.compile(r"^(self\.)?assert\w*\([^)]*get_boq_ai_api_key\s*\(")
        for dirpath, _dirs, files in os.walk(root):
            for fn in files:
                if not (fn.startswith("test_") and fn.endswith(".py")):
                    continue
                full = os.path.join(dirpath, fn)
                scanned += 1
                with open(full, "r", encoding="utf-8") as fh:
                    for i, line in enumerate(fh, start=1):
                        # strip STRING LITERALS first: a pin that compares source text mentions the
                        # getter inside quotes, which is not a call on the real value.
                        code = re.sub(r"\"[^\"]*\"|'[^']*'", '""', line.strip())
                        if rx.search(code):
                            bad.append("%s:%d" % (os.path.relpath(full, root), i))
        self.assertGreater(scanned, 50, "the sweep must actually reach the test files")
        self.assertEqual(bad, [], "a test passes the API key getter's value straight to an assertion; "
                                  "on failure that PRINTS THE SECRET -- assert on 'set'/'unset' instead")

    def test_the_unset_assertion_reports_only_set_or_unset(self):
        """T5 NEGATIVE half: the repaired test compares a two-valued state, never the key."""
        import inspect
        src = inspect.getsource(TestAISettings.test_get_boq_ai_api_key_returns_none_when_unset)
        # CODE ONLY -- the docstring deliberately quotes the retired shape to explain the defect, so a
        # whole-source scan would find it there and this pin would fail on its own explanation.
        body = src.split('"""')[-1]
        self.assertIn('"unset" if get_boq_ai_api_key() is None else "set"', body)
        self.assertNotIn("assertIsNone(get_boq_ai_api_key()", body)
        self.assertNotIn("assertIsNone", body)
