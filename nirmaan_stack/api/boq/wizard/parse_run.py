"""
BoQ wizard -- parse-run preparation functions (Slice 1, pure functions only).

No @frappe.whitelist endpoint or DB writes this slice (Slice 2 adds those).

Public API:
  assemble_mapping_config(boq_name) -> (MappingConfig, not_eligible: list[str])
  flatten_resolved_row(resolved_row, sheet_name, row_index) -> dict
  flatten_parsed_boq(parsed_boq, boq_name) -> list[dict]
"""
from __future__ import annotations

import json
import logging
from typing import Any

import frappe

from nirmaan_stack.services.boq_parser.config import (
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import ResolvedRow
from nirmaan_stack.services.boq_parser.orchestrator import ParsedBoq

logger = logging.getLogger(__name__)


def assemble_mapping_config(boq_name: str) -> tuple[MappingConfig, list[str]]:
    """
    Build a MappingConfig from the saved BOQs + BoQ Sheet Draft records.

    Returns (MappingConfig, not_eligible) where not_eligible is a list of
    sheet_names that were excluded because they are Pending, have unsupported
    statuses, or are Reviewed but missing a sheet_config blob.

    Inclusion rules applied in order:
      1. wizard_status in {Hidden, Skip}         -> SheetConfig(skip=True)
      2. sheet_name == BOQs.general_specs_sheet  -> treat_as="master_preamble"
      3. wizard_status in {Reviewed, Parsed}     -> deserialize blob, include as data
      4. anything else (Pending, Parse failed, blank, ...) -> not_eligible

    "Parsed" is treated the same as "Reviewed" because the sheet config is still
    valid and a re-run should re-parse configured sheets.

    GlobalSettings always uses defaults -- no per-BoQ override exists or is wanted.
    """
    if not boq_name or not frappe.db.exists("BOQs", boq_name):
        raise frappe.ValidationError(f"BoQ '{boq_name}' not found")

    boq_doc = frappe.get_doc("BOQs", boq_name)

    master_boq = MasterBoqMetadata(
        boq_name=boq_doc.boq_name or "",
        version=int(boq_doc.version or 1),
        tax_treatment=boq_doc.tax_treatment or "Pre-tax",
        notes=boq_doc.notes or "",
    )
    project = boq_doc.project or ""
    general_specs_sheet = boq_doc.general_specs_sheet or ""

    # GlobalSettings: always use defaults -- no per-BoQ override exists or is wanted.
    global_settings = GlobalSettings()

    sheet_configs: list[SheetConfig] = []
    not_eligible: list[str] = []

    for draft in boq_doc.sheet_drafts:
        sheet_name = draft.sheet_name
        status = draft.wizard_status or ""

        # Rule 1: skip / hidden sheets -- wizard_status is the single source of truth.
        if status in {"Hidden", "Skip"}:
            sheet_configs.append(SheetConfig(sheet_name=sheet_name, skip=True))
            continue

        # Rule 2: general-specs pointer (checked before wizard_status for active sheets).
        if general_specs_sheet and sheet_name == general_specs_sheet:
            sheet_configs.append(SheetConfig(
                sheet_name=sheet_name,
                treat_as="master_preamble",
            ))
            continue

        # Rule 3: Reviewed or Parsed (next lifecycle state after Reviewed).
        if status in {"Reviewed", "Parsed"}:
            blob = draft.sheet_config
            if not blob:
                logger.warning(
                    "BoQ %s sheet %r: wizard_status=%r but sheet_config is empty; excluding",
                    boq_name, sheet_name, status,
                )
                not_eligible.append(sheet_name)
                continue
            try:
                raw = json.loads(blob) if isinstance(blob, str) else blob
                sc = SheetConfig.model_validate(raw)
            except Exception as exc:
                logger.warning(
                    "BoQ %s sheet %r: invalid sheet_config (%s); excluding",
                    boq_name, sheet_name, exc,
                )
                not_eligible.append(sheet_name)
                continue
            sheet_configs.append(sc)
            continue

        # Rule 4: everything else (Pending, Parse failed, blank, ...) -> not_eligible.
        not_eligible.append(sheet_name)

    if not sheet_configs:
        raise frappe.ValidationError(
            f"BoQ '{boq_name}' has no eligible sheets for parsing. "
            "Mark at least one sheet as Reviewed."
        )

    config = MappingConfig(
        project=project,
        master_boq=master_boq,
        global_settings=global_settings,
        sheets=sheet_configs,
    )
    return config, not_eligible


def flatten_resolved_row(
    resolved_row: ResolvedRow,
    sheet_name: str,
    row_index: int,
) -> dict[str, Any]:
    """
    Map a parser ResolvedRow to a flat dict of BoQ Review Row field values.

    JSON fields (attached_notes, qty_by_area, amount_by_area, rate_by_area,
    validation_warnings, classifier_warnings, preamble_candidate_signals,
    append_notes_raw) are returned as Python objects (lists and dicts).

    Frappe insert behaviour for JSON fieldtype:
      - dict values: auto-serialized by Frappe (pass as-is)
      - list values: REJECTED by Frappe with "cannot be a list" unless the caller
        pre-serializes them via json.dumps() before doc.insert(). The list fields
        are: attached_notes, validation_warnings, classifier_warnings,
        preamble_candidate_signals.

    The 'boq' field is NOT included here; flatten_parsed_boq injects it.

    The 'boq' field is NOT included here; flatten_parsed_boq injects it.
    """
    cr = resolved_row.classified_row

    return {
        "sheet_name": sheet_name,
        "source_row_number": cr.raw_row.row_number,
        "row_index": row_index,
        "classification": cr.classification.value,
        "parent_index": resolved_row.parent_index,
        "level": resolved_row.level,
        "path": resolved_row.path or "",
        "attached_to_index": resolved_row.attached_to_index,
        # list[str] -- stored as JSON array
        "attached_notes": resolved_row.attached_notes,
        "promoted_from_line_item": cr.promoted_from_line_item,
        "preamble_level_override": cr.preamble_level_override,
        "sl_no_value": cr.sl_no_value,
        "description": cr.description,
        "unit": cr.unit,
        "make_model": cr.make_model,
        "is_rate_only": cr.is_rate_only,
        "qty_total": resolved_row.qty_total,
        "amount_total": resolved_row.amount_total,
        "rate_supply": cr.rate_supply,
        "rate_install": cr.rate_install,
        "rate_combined": cr.rate_combined,
        "amount_supply": cr.amount_supply,
        "amount_install": cr.amount_install,
        # dict[str, float] -- stored as JSON object (resolved post-pass, NOT _raw copy)
        "qty_by_area": resolved_row.qty_by_area,
        "amount_by_area": resolved_row.amount_by_area,
        # dict[str, dict[str, float|None]] -- stored as JSON object
        "rate_by_area": resolved_row.rate_by_area,
        "needs_classification_review": resolved_row.needs_classification_review,
        "review_reason": resolved_row.review_reason,
        # list[str] -- sum-validation warnings on ResolvedRow (distinct from classifier warnings)
        "validation_warnings": resolved_row.validation_warnings,
        # list[str] -- classifier-level warnings on ClassifiedRow
        "classifier_warnings": cr.warnings,
        "preamble_candidate_score": cr.preamble_candidate_score,
        # list[str] -- stored as JSON array
        "preamble_candidate_signals": cr.preamble_candidate_signals,
        "row_notes": cr.row_notes,
        # dict[str, str] -- stored as JSON object
        "append_notes_raw": cr.append_notes_raw,
        "is_synthetic": resolved_row.is_synthetic,
    }


def flatten_parsed_boq(parsed_boq: ParsedBoq, boq_name: str) -> list[dict[str, Any]]:
    """
    Flatten all sheets in a ParsedBoq to a list of BoQ Review Row field dicts.

    master_preamble sheets produce no rows (their text lives on ParsedBoq.master_preamble).
    row_index is the 0-based position within each sheet's resolved_rows list.
    Each dict includes 'boq': boq_name.
    """
    rows: list[dict[str, Any]] = []
    for parsed_sheet in parsed_boq.sheets:
        for row_index, resolved_row in enumerate(parsed_sheet.resolved_rows):
            d = flatten_resolved_row(resolved_row, parsed_sheet.sheet_name, row_index)
            d["boq"] = boq_name
            rows.append(d)
    return rows
