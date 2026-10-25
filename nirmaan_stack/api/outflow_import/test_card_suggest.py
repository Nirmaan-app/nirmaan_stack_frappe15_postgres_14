# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Suggest each card spend's expense type, and remember the types people confirm (#1569, spec #1565,
ADR-0037 ruling 5).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_card_suggest

Each test uploads the fixture statement through the real endpoint (`test_card_import.CardImportCase`; the
suggestion job it queues is recorded), then runs the suggestion job DIRECTLY, as the queue would, with
Gemini faked at the shared extraction service (`GeminiExtractor._build_client`). It asserts on the import
as Review reports it, and on the merchant memory Create and an Expense edit leave behind.

⚠️ Every test removes what it made; the fixture merchants' memory is cleared for the test and restored after
(`test_card_import._forget_fixture_merchants`).
"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import card_import, card_review, card_suggest
from nirmaan_stack.api.outflow_import.test_card_create import EXPENSE, HOTEL, MISC, CardCreateCase, _purge_created
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT
from nirmaan_stack.services.extraction.gemini import GeminiExtractor
from nirmaan_stack.services.outflow_import.tests.card_pdf_builder import pdf_from_text

MEMORY = "Card Merchant Memory"
PARK = "PARK RESIDENCY Cochin IN"
SWIGGY = "Swiggy Limited Bangalore IN"
FOOD = "Staff Welfare Expenses"

_SETTINGS = {
    "enabled": True,
    "provider": "gemini",
    "auth_mode": "API Key",
    "gemini_model": "canned-model",
    "gemini_thinking_level": "low",
    "request_timeout_seconds": 30,
}


class _FakeModels:
    """Gemini's `models`: answers every call with `answers`, or fails; keeps each prompt it was given."""

    def __init__(self, answers: list[dict] | None = None, fail: bool = False):
        self.answers = answers or []
        self.fail = fail
        self.prompts = []

    def generate_content(self, model, contents, config):
        self.prompts.append("\n".join(str(part) for part in contents))
        if self.fail:
            raise RuntimeError("PERMISSION_DENIED: canned failure")
        return SimpleNamespace(text=json.dumps({"answers": self.answers}), candidates=[])


class CardSuggestCase(CardCreateCase):
    def _suggest(self, answers=None, *, fail=False, settings=_SETTINGS) -> _FakeModels:
        models = _FakeModels(answers, fail)
        with patch.object(card_suggest, "get_extraction_settings", return_value=settings), \
                patch.object(GeminiExtractor, "_build_client", return_value=SimpleNamespace(models=models)):
            card_suggest.suggest_card_types(self.batch)
        return models

    def _shown(self, details: str) -> list[dict]:
        return [line for line in self._review()["lines"] if line["details"] == details]

    def _remember(self, merchant: str, expense_type: str) -> None:
        frappe.get_doc({"doctype": MEMORY, "merchant": merchant, "expense_type": expense_type}).insert(
            ignore_permissions=True
        )
        frappe.db.commit()

    def _memory(self, merchant: str):
        return frappe.db.get_value(MEMORY, merchant, ["expense_type", "confirmed_by", "confirmed_at"], as_dict=True)


class TestUploadStartsSuggestion(CardSuggestCase):
    def test_upload_queues_one_suggestion_job_de_duplicated_per_import(self):
        [job] = self.enqueued
        self.assertEqual(job["job_id"], f"card-suggest-{self.batch}")
        self.assertTrue(job["deduplicate"])
        self.assertEqual(job["batch"], self.batch)

    def test_review_says_whether_suggestion_is_still_running(self):
        self.assertFalse(self._review()["suggest_running"])
        with patch.object(card_import, "is_job_enqueued", side_effect=lambda job: job.startswith("card-suggest-")):
            self.assertTrue(self._review()["suggest_running"])

    def test_create_waits_for_suggestion(self):
        with patch.object(card_import, "is_job_enqueued", side_effect=lambda job: job.startswith("card-suggest-")):
            with self.assertRaises(frappe.ValidationError):
                self._press_create()

    def test_each_spend_names_its_merchant(self):
        lines = [line for line in self._review()["lines"] if "MAKEMYTRIP" in line["details"].upper()]
        # The three spellings of MakeMyTrip are one merchant; a credit has none.
        self.assertEqual({line["merchant"] for line in lines if not line["is_credit"]}, {"MAKEMYTRIP"})
        self.assertEqual({line["merchant"] for line in lines if line["is_credit"]}, {None})


class TestTheAiTypesNewMerchants(CardSuggestCase):
    def test_a_confident_answer_on_the_live_list_is_the_spends_type_marked_ai(self):
        self._suggest([{"merchant": "PARK RESIDENCY", "expense_type": HOTEL, "confidence": 0.95}])
        [line] = self._shown(PARK)
        self.assertEqual((line["expense_type"], line["type_source"], line["check"]), (HOTEL, "AI", False))

    def test_one_call_for_every_merchant_given_the_live_type_list(self):
        models = self._suggest([])
        self.assertEqual(len(models.prompts), 1)
        prompt = models.prompts[0]
        for merchant in ("PARK RESIDENCY", "SWIGGY", "MAKEMYTRIP", "ZOMATO"):
            self.assertIn(merchant, prompt)
        self.assertIn(HOTEL, prompt)
        self.assertIn(MISC, prompt)
        # A credit is not a spend: never asked about.
        self.assertNotIn("UPI PAYMENT RECEIVED", prompt)

    def test_every_spend_of_the_merchant_gets_the_answer(self):
        self._suggest([{"merchant": "SWIGGY", "expense_type": FOOD, "confidence": 0.9}])
        lines = self._shown(SWIGGY)
        self.assertEqual(len(lines), 2)
        self.assertEqual({(line["expense_type"], line["type_source"]) for line in lines}, {(FOOD, "AI")})

    def test_an_answer_not_on_the_live_list_falls_back_to_misc_marked_check(self):
        self._suggest([{"merchant": "PARK RESIDENCY", "expense_type": "Scaffolding Rent", "confidence": 0.99}])
        [line] = self._shown(PARK)
        self.assertEqual((line["expense_type"], line["type_source"], line["check"]), (MISC, "Fallback", True))

    def test_a_low_confidence_answer_falls_back_to_misc_marked_check(self):
        self._suggest([{"merchant": "PARK RESIDENCY", "expense_type": HOTEL, "confidence": 0.3}])
        [line] = self._shown(PARK)
        self.assertEqual((line["expense_type"], line["type_source"], line["check"]), (MISC, "Fallback", True))

    def test_a_failed_call_leaves_every_spend_at_misc_marked_check_and_does_not_raise(self):
        self._suggest(fail=True)
        spends = [line for line in self._review()["lines"] if not line["is_credit"]]
        self.assertEqual({(line["expense_type"], line["type_source"]) for line in spends}, {(MISC, "Fallback")})
        # The import goes on: Create is still offered.
        _, jobs = self._press_create()
        self.assertEqual(len(jobs), 1)

    def test_ai_switched_off_is_a_failed_call(self):
        models = self._suggest([{"merchant": "PARK RESIDENCY", "expense_type": HOTEL, "confidence": 0.95}],
                               settings={"enabled": False})
        self.assertEqual(models.prompts, [])
        [line] = self._shown(PARK)
        self.assertEqual(line["type_source"], "Fallback")

    def test_a_type_chosen_on_review_is_never_overwritten(self):
        [line] = self._shown(PARK)
        card_review.set_card_expense_type(self.batch, [line["name"]], MISC)
        self._suggest([{"merchant": "PARK RESIDENCY", "expense_type": HOTEL, "confidence": 0.95}])
        [line] = self._shown(PARK)
        self.assertEqual((line["expense_type"], line["type_source"]), (MISC, "Chosen on Review"))


class TestMemoryComesFirst(CardSuggestCase):
    def test_a_merchant_in_memory_gets_its_remembered_type_without_asking_the_ai(self):
        self._remember("PARK RESIDENCY", HOTEL)
        models = self._suggest([{"merchant": "PARK RESIDENCY", "expense_type": FOOD, "confidence": 0.99}])
        [line] = self._shown(PARK)
        self.assertEqual((line["expense_type"], line["type_source"], line["check"]), (HOTEL, "Earlier statement", False))
        self.assertNotIn("PARK RESIDENCY", models.prompts[0])

    def test_every_merchant_in_memory_means_no_call_at_all(self):
        for line in self._review()["lines"]:
            if not line["is_credit"] and not frappe.db.exists(MEMORY, line["merchant"]):
                self._remember(line["merchant"], MISC)
        models = self._suggest([])
        self.assertEqual(models.prompts, [])
        spends = [line for line in self._review()["lines"] if not line["is_credit"]]
        self.assertEqual({line["type_source"] for line in spends}, {"Earlier statement"})


class TestConfirmedTypesAreRemembered(CardSuggestCase):
    def test_create_remembers_each_created_spends_type_by_merchant(self):
        [line] = self._shown(PARK)
        card_review.set_card_expense_type(self.batch, [line["name"]], HOTEL)
        self._press_create()
        self._run_create()
        memory = self._memory("PARK RESIDENCY")
        self.assertEqual((memory.expense_type, memory.confirmed_by), (HOTEL, "Administrator"))
        self.assertTrue(memory.confirmed_at)
        # A spend left at the fallback is confirmed by Create too.
        self.assertEqual(self._memory("ZOMATO").expense_type, MISC)

    def test_next_months_statement_is_typed_from_it(self):
        [line] = self._shown(PARK)
        card_review.set_card_expense_type(self.batch, [line["name"]], HOTEL)
        self._press_create()
        self._run_create()
        # Next month's statement: the same holder, a new period, new SerNos.
        text = self._text(serno_base=self.serno_base + 5000).replace(
            "Statement period : September 2, 2026 to October 1, 2026",
            "Statement period : October 2, 2026 to November 1, 2026",
        )
        self.batch = self._upload(pdf_from_text(text))["batch"]
        self.addCleanup(_purge_created, self.batch)
        self._suggest([])
        [line] = self._shown(PARK)
        self.assertEqual((line["expense_type"], line["type_source"]), (HOTEL, "Earlier statement"))

    def test_editing_a_card_expenses_type_remembers_it_for_the_merchant(self):
        self._press_create()
        self._run_create()
        [line] = self._shown(PARK)
        accountant = self.users.make(ACCOUNTANT)
        expense = frappe.get_doc(EXPENSE, line["expense"])
        frappe.set_user(accountant)
        try:
            expense.type = HOTEL
            expense.save(ignore_permissions=True)
        finally:
            frappe.set_user("Administrator")
        memory = self._memory("PARK RESIDENCY")
        self.assertEqual((memory.expense_type, memory.confirmed_by), (HOTEL, accountant))

    def test_an_edit_that_keeps_the_type_changes_no_memory(self):
        self._press_create()
        self._run_create()
        [line] = self._shown(PARK)
        frappe.db.set_value(MEMORY, "PARK RESIDENCY", "confirmed_by", "Guest")
        expense = frappe.get_doc(EXPENSE, line["expense"])
        expense.description = f"{expense.description} (edited)"
        expense.save(ignore_permissions=True)
        self.assertEqual(self._memory("PARK RESIDENCY").confirmed_by, "Guest")
