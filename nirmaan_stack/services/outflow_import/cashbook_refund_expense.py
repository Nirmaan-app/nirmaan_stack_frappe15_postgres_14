# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Where a *Wallet refund expense* goes (#1709, spec #1711, ADR-0015 Amendment D). GLOSSARY: *Wallet refund expense*.

PURE MODULE. `cashbook.plan_statement` asks `refund_placement` of every refund that did not pair; the job writes the
Expense at minus the refund's Credit, described by `refund_description`.

Owner decisions (2026-11-18):
  1. The refund names a spend (`REF-<Txn Id>`) that has an Expense: it goes on that Expense's doctype, project and
     expense type AS THE EXPENSE IS NOW, whatever the spend's date. "Has an Expense" is the only test. A spend on this
     same statement that the plan creates has one too: the refund goes where that spend is placed.
  2. Otherwise (no Expense, or no `REF-` spend): placed from the refund's own remark the way a spend is
     (`cashbook_placement.placement`): on a project when the remark names exactly one, else a Non Project Expense,
     typed from the remark, else Petty Cash. #1720 decision 3 (owner, 2026-11-18) changed this branch, which was
     always Non-Project, so a refund and a Wallet Credit follow one rule.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

from nirmaan_stack.services.outflow_import.cashbook_placement import placement
from nirmaan_stack.services.outflow_import.cashbook_refunds import WALLET_CREDIT_ROW_KIND, refunded_spend_id
from nirmaan_stack.services.outflow_import.project_match import ProjectIndex

__all__ = ["RefundPlacement", "SpendExpense", "refund_placement", "refund_description", "money_in_description"]


@dataclass(frozen=True)
class SpendExpense:
    """The Expense a refund's spend is booked on, as it is now: its ledger, name, project and type."""

    doctype: str
    name: str
    project: str | None
    project_name: str
    expense_type: str


@dataclass(frozen=True)
class RefundPlacement:
    """Where an unpaired refund's Expense goes: the `PlannedRow` fields of a *Wallet refund expense*, the same fields
    on every branch. `refund_of`: the spend Txn Id it names (blank when none); `reduces`: that spend's existing
    Expense (blank when it has none); `spend_on_statement`: this statement creates the spend."""

    ledger: str
    project: str | None
    project_name: str
    expense_type: str
    matched_keyword: str
    refund_of: str
    reduces: str
    spend_on_statement: bool


def refund_placement(
    transfer_id: str,
    remarks: str,
    booked: SpendExpense | None,
    planned_spend: Mapping | None,
    index: ProjectIndex,
    expense_rules: Mapping[str, Sequence[tuple[str, str]]],
) -> RefundPlacement:
    """Where an unpaired refund's Expense goes. `booked`: its spend's existing Expense, if any; `planned_spend`: the
    placement this plan gives its spend when the spend is created from this statement; else its own remark is placed
    against `index` and `expense_rules`."""
    refund_of = refunded_spend_id(transfer_id)
    if booked is not None:
        return RefundPlacement(
            ledger=booked.doctype,
            project=booked.project or None,
            project_name=booked.project_name or "",
            expense_type=booked.expense_type,
            matched_keyword="",
            refund_of=refund_of,
            reduces=booked.name,
            spend_on_statement=False,
        )
    if planned_spend is not None:
        return RefundPlacement(
            ledger=planned_spend["ledger"],
            project=planned_spend["project"],
            project_name=planned_spend["project_name"],
            expense_type=planned_spend["expense_type"],
            matched_keyword="",
            refund_of=refund_of,
            reduces="",
            spend_on_statement=True,
        )
    return RefundPlacement(
        **placement(remarks, index, expense_rules),
        refund_of=refund_of,
        reduces="",
        spend_on_statement=False,
    )


def refund_description(transfer_id: str, payee: str) -> str:
    """"Wallet refund of OBO… from MakemytripIndia Pvt Ltd"; either part is left out when the line lacks it."""
    spend = refunded_spend_id(transfer_id)
    return " ".join(
        part for part in ("Wallet refund", f"of {spend}" if spend else "", f"from {payee}" if payee else "") if part
    )


def money_in_description(row_kind: str, transfer_id: str, payee: str) -> str:
    """The description of a line booked at minus its Credit: a refund's (`refund_description`), or a Wallet Credit's
    (#1720) "Wallet credit from <who paid it in>", the payer left out when the line has none."""
    if row_kind == WALLET_CREDIT_ROW_KIND:
        return f"Wallet credit from {payee}" if payee else "Wallet credit"
    return refund_description(transfer_id, payee)
