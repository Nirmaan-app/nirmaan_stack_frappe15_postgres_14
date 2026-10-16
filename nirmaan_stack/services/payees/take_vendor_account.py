# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""A PO / WO payment is paid into its vendor's current account (#1463, spec #1420, ADR-0033
decision 9, revised 2026-10-16).

When a PO / WO payment whose vendor's Payee changed since it was raised, or that was raised with
no copy, is put in a bank file or marked paid, its pay-to account is first replaced by the vendor's
account, so the copy records the account the money actually went to. The payer is told before that
happens (GLOSSARY *Pay-to account*): the screen sends the switch it showed for each payment, and a
switch it did not show is refused. Which payments switch, and to what, is
`paid_to.vendor_account_to_take`, read through `paid_to.paid_to_rows`; this only writes it.

* `take_vendor_accounts` -- write the vendor's account onto each named payment that switches, as the
  payer was shown, and answer where each one is paid now and which were no longer Approved.
"""

from __future__ import annotations

import frappe
from frappe import _

from nirmaan_stack.services.payees.paid_to import PAYMENT_DOCTYPE, account_key, paid_to_rows, row_facts
from nirmaan_stack.services.payees.pay_to import set_pay_to
from nirmaan_stack.services.settlement import STATUS_APPROVED


def take_vendor_accounts(payments: list[dict]) -> dict:
    """Replace each PO / WO payment's pay-to account with its vendor's account where the payment
    switches to it (`paid_to_rows`' `switch_to`); leave the rest untouched. `payments` is `[{name,
    shown}]`: `shown` the vendor's account the payer was shown the payment is paid into (the
    `switch_to` the screen displayed), or None when it showed no switch.

    Each payment is locked and read again first. One no longer Approved is skipped, not refused: a
    paid payment's copy says where its money went, and one stale row must not block the rest. Every
    other payment's fresh decision is compared with what the payer was shown (`paid_to.account_key`:
    normalised account number and IFSC, the switch rule's own comparison); on any difference the whole
    call is refused, naming each payment, and nothing is written.

    Returns `{taken: [{name, paid_to}], skipped: [{name, status}]}`, in the order sent, each `paid_to`
    the payment's answer read under the lock: a switched one's `switch_to` is exactly the account
    written onto it, an unswitched one's `account` the one it keeps. Export for Payment builds the
    bank file from these. The save leaves the Version row that records who switched it and when
    (`ignore_version=False`, as Frappe skips it under tests otherwise). The caller checks write
    permission. Never commits."""
    shown = {}
    for payment in payments:
        shown.setdefault(payment["name"], payment.get("shown"))
    docs, skipped = [], []
    for name in shown:
        doc = frappe.get_doc(PAYMENT_DOCTYPE, name, for_update=True)
        if doc.status == STATUS_APPROVED:
            docs.append(doc)
        else:
            skipped.append({"name": name, "status": doc.status})
    answers = paid_to_rows([row_facts(PAYMENT_DOCTYPE, doc) for doc in docs])
    changed = [doc for doc, paid_to in zip(docs, answers)
               if account_key(paid_to["switch_to"]) != account_key(shown[doc.name])]
    if changed:
        frappe.throw(_("The vendor's account for {0} changed again. Refresh and try again.")
                     .format(", ".join(doc.get("document_name") or doc.name for doc in changed)))
    for doc, paid_to in zip(docs, answers):
        if paid_to["switch_to"]:
            set_pay_to(doc, paid_to["switch_to"])
            doc.save(ignore_permissions=True, ignore_version=False)
    return {"taken": [{"name": doc.name, "paid_to": paid_to} for doc, paid_to in zip(docs, answers)],
            "skipped": skipped}
