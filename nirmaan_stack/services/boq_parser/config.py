"""
Pydantic models for the BoQ parser mapping configuration.

A MappingConfig is produced once per workbook (by the mapping UI in Phase 3
or hand-crafted in tests) and drives the parser in Phase 2b/2c.  This module
is pure-Python with no Frappe imports so it can be tested independently.
"""
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# ------------------------------------------------------------------
# Roles a column can play
# ------------------------------------------------------------------

_AREA_COMPATIBLE_ROLES = {
    "qty", "amount_supply", "amount_install", "amount_total",
    "amount_by_area",
}

_SINGLETON_ROLES = {
    "sl_no", "description", "unit", "qty_total",
    "rate_supply", "rate_install", "rate_combined",
    "amount_total", "amount_combined", "make_model", "row_notes", "reference_images",
}

_VALID_COL_LETTER = re.compile(r"^[A-Z]+$")


class ColumnRole(BaseModel):
    role: Literal[
        "sl_no", "description", "unit", "qty", "qty_total",
        "rate_supply", "rate_install", "rate_combined",
        "amount_supply", "amount_install", "amount_total", "amount_combined",
        # qty_by_area deprecated Phase 2c §9 #42 — use role="qty" with area= instead
        "amount_by_area",
        "make_model", "row_notes", "reference_images", "ignore",
    ]
    area: str | None = None

    @model_validator(mode="after")
    def area_only_for_qty_amount_roles(self) -> "ColumnRole":
        if self.area is not None and self.role not in _AREA_COMPATIBLE_ROLES:
            raise ValueError(
                f"'area' is only valid for roles {_AREA_COMPATIBLE_ROLES}; "
                f"got role='{self.role}'"
            )
        return self

    @model_validator(mode="after")
    def area_required_for_amount_by_area_role(self) -> "ColumnRole":
        if self.role == "amount_by_area" and not self.area:
            raise ValueError(f"role {self.role} requires area")
        return self


# ------------------------------------------------------------------
# Per-sheet configuration
# ------------------------------------------------------------------

class SheetConfig(BaseModel):
    sheet_name: str
    skip: bool = False
    treat_as: Literal["data", "master_preamble"] = "data"
    package_name: str | None = None
    header_row: int | None = None
    header_row_count: Literal[1, 2] = 1
    skip_top_rows_after_header: list[int] = []
    column_role_map: dict[str, ColumnRole] = {}
    area_dimensions: list[str] = []
    rate_only_markers_override: list[str] | None = None
    level_1_style_override: Optional[Literal["letter", "roman", "numeric", "part"]] = None

    @field_validator("column_role_map", mode="before")
    @classmethod
    def column_letters_must_be_valid(cls, v: dict) -> dict:
        for key in v:
            if not _VALID_COL_LETTER.match(key):
                raise ValueError(
                    f"column_role_map key '{key}' is not a valid Excel column "
                    f"letter (expected uppercase A-Z only, e.g. 'A', 'AB')"
                )
        return v

    @model_validator(mode="after")
    def validate_sheet_config(self) -> "SheetConfig":
        # header_row required for active data sheets
        if self.treat_as == "data" and not self.skip and self.header_row is None:
            raise ValueError(
                f"sheet '{self.sheet_name}': header_row is required when "
                f"treat_as='data' and skip=False"
            )

        # master_preamble sheets don't need column maps — no further validation
        if self.treat_as == "master_preamble":
            return self

        roles = list(self.column_role_map.values())
        role_names = [r.role for r in roles]

        # Singleton roles must appear at most once
        for singleton in _SINGLETON_ROLES:
            if role_names.count(singleton) > 1:
                raise ValueError(
                    f"sheet '{self.sheet_name}': role '{singleton}' appears "
                    f"more than once in column_role_map"
                )

        # Per-area uniqueness: each area can appear at most once per area-compatible role
        for area_role in _AREA_COMPATIBLE_ROLES:
            area_counts: dict[str, int] = {}
            for cr in roles:
                if cr.role == area_role and cr.area:
                    area_counts[cr.area] = area_counts.get(cr.area, 0) + 1
            for area, count in area_counts.items():
                if count > 1:
                    raise ValueError(
                        f"sheet '{self.sheet_name}': area '{area}' has {count} "
                        f"columns with role '{area_role}' — only one allowed per area"
                    )

        # area values must be declared in area_dimensions
        declared = set(self.area_dimensions)
        for col_letter, cr in self.column_role_map.items():
            if cr.area is not None and cr.area not in declared:
                raise ValueError(
                    f"sheet '{self.sheet_name}': column '{col_letter}' references "
                    f"area '{cr.area}' which is not in area_dimensions {self.area_dimensions}"
                )

        return self


# ------------------------------------------------------------------
# Top-level config
# ------------------------------------------------------------------

class GlobalSettings(BaseModel):
    rate_only_markers: list[str] = ["RO", "ro", "R/O", "RATE ONLY"]
    multi_area_reserved_keywords: list[str] = Field(
        default_factory=lambda: [
            # Quantity / unit columns
            "UNIT", "UOM", "MEASURE",
            "QTY", "QUANTITY", "NOS",
            # Rate columns
            "RATE", "SUPPLY RATE", "INSTALL RATE", "INSTALLATION RATE", "COMBINED RATE",
            "TOTAL RATE",
            # Amount columns
            "AMOUNT", "SUPPLY AMOUNT", "INSTALL AMOUNT",
            # Totals / summary
            "TOTAL", "TOTAL QTY", "TOTAL AMOUNT",
            "DRAWING QTY", "REMARKS",
            # Metadata / structural
            "DESCRIPTION", "PART", "BOQ", "RATE/SFT",
            # Sl.No. / Serial Number variants (fixes false-positive on S No. / Sl.No. headers)
            "SL.NO", "SL.NO.", "SL NO", "SL NO.", "SLNO",
            "S NO", "S NO.", "S.NO", "S.NO.", "SNO", "S/N",
            "SR NO", "SR NO.", "SR.NO", "SR.NO.",
            "SERIAL NO", "SERIAL NO.", "SERIAL NUMBER",
            # Item variants
            "ITEM", "ITEMS", "ITEM DESCRIPTION", "ITEM NO", "ITEM NO.",
            # Description shorthand variants
            "DESC", "DESC.",
            # --- Phase 2c expansion: 71 new entries across 6 buckets ---
            # Bucket 1 — Quantity / measurement extended variants
            "NO", "NOS.", "NO.", "NUMBER", "QTY.", "QUANTITIES",
            "SQ FT", "SQ.FT", "SQ.FT.", "SQFT", "SQ MT", "SQ.MT", "SQ.MT.", "SQMT",
            "RFT", "RMT", "RUN FT", "RUNNING FT", "RUNNING MT",
            # Bucket 2 — Rate extended variants
            "RATE (RS)", "RATE (INR)", "UNIT RATE", "BASIC RATE", "BASIC RATE (INR)",
            "LABOUR RATE", "MATERIAL RATE", "SUPPLY & FIX RATE",
            # Bucket 3 — Amount extended variants
            "AMOUNT (RS)", "AMOUNT (INR)", "TOTAL AMOUNT (RS)", "TOTAL AMOUNT (INR)",
            "SUPPLY TOTAL", "INSTALL TOTAL", "INSTALLATION TOTAL", "LABOUR AMOUNT",
            "MATERIAL AMOUNT", "SUPPLY & FIX AMOUNT",
            # Bucket 4 — Structural / specification columns
            "MAKE", "MAKE & MODEL", "BRAND", "SPECIFICATION", "SPECIFICATIONS",
            "SPEC", "SPECS", "REFERENCE", "REF", "REF.", "DRAWING REF",
            "SUBJECT", "PARTICULAR", "PARTICULARS", "WORK", "WORKS",
            "FLOOR", "LOCATION", "SCOPE",
            # Bucket 5 — Cost-code / estimation columns
            "DSR", "DSR RATE", "MARKET RATE", "QUOTED RATE", "AGREED RATE",
            "SCHEDULE OF RATE", "SOR", "BOQ RATE", "CONTRACT RATE",
            # Bucket 6 — Summary / structural sheet keywords
            "SUMMARY", "GRAND TOTAL", "SUB TOTAL", "SUBTOTAL", "NET AMOUNT",
            "NET TOTAL",
            # --- Phase 2c follow-on: 71 targeted entries from §9 #44 audit ---
            # Metadata top-row labels (15)
            "SUBJECT:", "VERSION", "VERSION:", "PROJECT", "PROJECT:",
            "TITLE", "TITLE:", "REV", "REV:", "REV :",
            "DATE / R. NO", "NAME OF WORK", "RO", "R0", "SUB",
            # Sl.No / Description variants with space, typos, plurals (22)
            "SL. NO", "SL. NO.", "S. NO", "S. NO.", "SR. NO",
            "SR. NO.", "SI NO", "SI NO.", "SI.NO", "SI.NO.",
            "S.L", "#",
            "DESCRIPTION OF ITEMS", "DESCRIPTION OF ITEM", "DESCRIPTION OF WORK",
            "DESCRIPTION OF THE ITEM", "DESCRIPTIONS",
            "PRODUCT / ITEM DESCRIPTION", "DISCRIPTION", "DESCIRPTION",
            "ITEM DESCRIPTIONS", "PARTICULARS.",
            # Per-row-attribution columns (8)
            "AREA", "AREA OF USE", "ACTIVITY", "WORKITEM",
            "LOCATIONS", "TAG NO", "CODE", "UNIT.",
            # Bare column-role labels (9)
            "SUPPLY", "INSTALLATION", "PACKAGE", "REMARK",
            "SUPPLY AMOUNT", "INSTALLATION AMOUNT", "TOTAL AMOUNT",
            "SUPPLY RATE", "AMOUNT - INR",
            # DSR full variants (5)
            "NDSR", "DSR / NDSR", "DSR / NDSR (MR)", "DSR/ MR", "DSR / MR",
            # Make / Materials / Reference full variants (12)
            "MANUFACTURERS NAME", "DETAILS OF MATERIALS",
            "MAKE/MANUFACTURERS NAME", "PART CODE", "MODEL NO",
            "IMAGE", "REFERENCE IMAGE", "REF IMAGE",
            "MATERIAL CODE", "SIZE/MAKE", "SIZE/MAKE.", "TYPE",
            # ===== Phase 2c §9 #48 expansion (added 2026-05-16) =====

            # SITC / S&I family — combined-role labels and merged-header labels
            "SITC",
            "S&I",
            "S+I",
            "SITC RATE",
            "SITC AMOUNT",
            "S&I RATE",
            "S&I AMOUNT",
            "S+I RATE",
            "S+I AMOUNT",
            "SUPPLY & INSTALLATION",
            "SUPPLY & INSTALLATION RATE",
            "SUPPLY & INSTALLATION AMOUNT",
            "SUPPLY AND INSTALLATION",
            "SUPPLY AND INSTALLATION RATE",
            "SUPPLY AND INSTALLATION AMOUNT",
            "SUPPLY, INSTALL & COMMISSIONING RATE",

            # Unit column header label
            "U.O.M",

            # "IN INR/RS" variants (trailing-paren strip doesn't catch these)
            "RATE IN INR",
            "RATE IN RS",
            "RATE IN RS.",
            "AMOUNT IN INR",
            "AMOUNT IN RS",
            "AMOUNT IN RS.",

            # DSR additional variants
            "NDSR (MR)",

            # Combined / Total labels
            "COMBINED AMOUNT",

            # "AS PER BOQ" compound variants
            "AS PER BOQ TOTAL AMOUNT",
            "AS PER BOQ TOTAL SUPPLY",
            "AS PER BOQ TOTAL SUPPLY AMOUNT",
            "AS PER BOQ TOTAL INSTALLATION",
            "AS PER BOQ TOTAL ERECTION AMOUNT",
            "AS PER BNOQ TOTAL AMOUNT",  # typo variant — real BoQs have this

            # Sl_No standalone variants
            "SR.",

            # Per-row attribution
            "AREA OF WORK",
        ],
        description="Words to exclude when auto-detecting area names. User-extensible."
    )


class MasterBoqMetadata(BaseModel):
    boq_name: str
    version: int = 1
    tax_treatment: Literal["Pre-tax", "Post-tax"] = "Pre-tax"
    notes: str = ""


class MappingConfig(BaseModel):
    project: str
    master_boq: MasterBoqMetadata
    global_settings: GlobalSettings = GlobalSettings()
    sheets: list[SheetConfig]

    @field_validator("sheets")
    @classmethod
    def sheets_must_be_non_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("sheets must contain at least one SheetConfig")
        return v

    @model_validator(mode="after")
    def sheet_names_must_be_unique(self) -> "MappingConfig":
        names = [s.sheet_name for s in self.sheets]
        if len(names) != len(set(names)):
            seen: set[str] = set()
            for name in names:
                if name in seen:
                    raise ValueError(
                        f"Duplicate sheet_name '{name}' in sheets list"
                    )
                seen.add(name)
        return self
