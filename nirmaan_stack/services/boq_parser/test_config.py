# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import unittest

from pydantic import ValidationError

from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    GlobalSettings,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)


def _master_boq() -> MasterBoqMetadata:
    return MasterBoqMetadata(boq_name="Civil BoQ")


def _data_sheet(name: str = "Sheet1", header_row: int = 1, **kwargs) -> SheetConfig:
    return SheetConfig(sheet_name=name, header_row=header_row, **kwargs)


def _minimal_config(**overrides) -> MappingConfig:
    defaults = dict(
        project="TEST-PROJECT",
        master_boq=_master_boq(),
        sheets=[_data_sheet()],
    )
    defaults.update(overrides)
    return MappingConfig(**defaults)


class TestMappingConfig(unittest.TestCase):
    """Group 2a-A: Mapping config validation."""

    # ------------------------------------------------------------------ #
    # Test 1 — valid full config                                           #
    # ------------------------------------------------------------------ #

    def test_valid_full_config_parses_cleanly(self):
        """A complete config with data, master_preamble, and skip sheets parses."""
        config = MappingConfig(
            project="PRJ-001",
            master_boq=MasterBoqMetadata(
                boq_name="Full Civil BoQ", version=2, tax_treatment="Pre-tax"
            ),
            global_settings=GlobalSettings(rate_only_markers=["RO", "R/O"]),
            sheets=[
                SheetConfig(
                    sheet_name="Data Sheet",
                    header_row=3,
                    header_row_count=2,
                    area_dimensions=["B1", "B3", "B6"],
                    column_role_map={
                        "A": ColumnRole(role="sl_no"),
                        "B": ColumnRole(role="description"),
                        "C": ColumnRole(role="unit"),
                        "D": ColumnRole(role="qty", area="B1"),
                        "E": ColumnRole(role="qty", area="B3"),
                        "F": ColumnRole(role="qty", area="B6"),
                        "G": ColumnRole(role="qty_total"),
                        "H": ColumnRole(role="rate_supply"),
                        "I": ColumnRole(role="rate_install"),
                        "J": ColumnRole(role="rate_combined"),
                        "K": ColumnRole(role="amount_supply", area="B1"),
                        "L": ColumnRole(role="amount_total"),
                        "M": ColumnRole(role="make_model"),
                        "N": ColumnRole(role="row_notes"),
                        "O": ColumnRole(role="reference_images"),
                        "P": ColumnRole(role="ignore"),
                    },
                ),
                SheetConfig(
                    sheet_name="Preamble",
                    treat_as="master_preamble",
                ),
                SheetConfig(
                    sheet_name="Summary",
                    skip=True,
                ),
            ],
        )
        self.assertEqual(config.project, "PRJ-001")
        self.assertEqual(len(config.sheets), 3)
        self.assertEqual(config.sheets[0].area_dimensions, ["B1", "B3", "B6"])

    # ------------------------------------------------------------------ #
    # Test 2 — invalid column letter                                       #
    # ------------------------------------------------------------------ #

    def test_invalid_excel_column_letter_rejected(self):
        """Non-letter keys in column_role_map raise ValidationError."""
        with self.assertRaises(ValidationError):
            SheetConfig(
                sheet_name="Bad",
                header_row=1,
                column_role_map={"AA1": ColumnRole(role="description")},
            )

    def test_lowercase_column_letter_rejected(self):
        """Lowercase keys in column_role_map raise ValidationError."""
        with self.assertRaises(ValidationError):
            SheetConfig(
                sheet_name="Bad",
                header_row=1,
                column_role_map={"a": ColumnRole(role="description")},
            )

    # ------------------------------------------------------------------ #
    # Test 3 — area on non-qty/amount role                                 #
    # ------------------------------------------------------------------ #

    def test_area_on_non_qty_amount_role_rejected(self):
        """ColumnRole with area set on a non-area-compatible role raises ValidationError."""
        with self.assertRaises(ValidationError):
            ColumnRole(role="description", area="B1")

    def test_area_on_qty_role_is_valid(self):
        """ColumnRole(role='qty', area='B1') is valid."""
        cr = ColumnRole(role="qty", area="B1")
        self.assertEqual(cr.area, "B1")

    # ------------------------------------------------------------------ #
    # Test 4 — area referencing undeclared dimension                       #
    # ------------------------------------------------------------------ #

    def test_area_referencing_undeclared_dimension_rejected(self):
        """A ColumnRole whose area is not in area_dimensions raises ValidationError."""
        with self.assertRaises(ValidationError):
            SheetConfig(
                sheet_name="MultiArea",
                header_row=1,
                area_dimensions=["B1"],
                column_role_map={"D": ColumnRole(role="qty", area="B99")},
            )

    # ------------------------------------------------------------------ #
    # Test 5 — two qty_total columns                                       #
    # ------------------------------------------------------------------ #

    def test_two_qty_total_columns_rejected(self):
        """Two columns with role='qty_total' in one sheet raises ValidationError."""
        with self.assertRaises(ValidationError):
            SheetConfig(
                sheet_name="Duplicate",
                header_row=1,
                column_role_map={
                    "G": ColumnRole(role="qty_total"),
                    "H": ColumnRole(role="qty_total"),
                },
            )

    def test_two_description_columns_rejected(self):
        """Two columns with role='description' in one sheet raises ValidationError."""
        with self.assertRaises(ValidationError):
            SheetConfig(
                sheet_name="Duplicate",
                header_row=1,
                column_role_map={
                    "B": ColumnRole(role="description"),
                    "C": ColumnRole(role="description"),
                },
            )

    # ------------------------------------------------------------------ #
    # Test 6 — empty sheets list                                           #
    # ------------------------------------------------------------------ #

    def test_empty_sheets_list_rejected(self):
        """MappingConfig with no sheets raises ValidationError."""
        with self.assertRaises(ValidationError):
            MappingConfig(
                project="PRJ",
                master_boq=_master_boq(),
                sheets=[],
            )

    def test_duplicate_sheet_names_rejected(self):
        """Two SheetConfigs with identical sheet_name raise ValidationError."""
        with self.assertRaises(ValidationError):
            MappingConfig(
                project="PRJ",
                master_boq=_master_boq(),
                sheets=[
                    _data_sheet("Sheet1"),
                    _data_sheet("Sheet1"),
                ],
            )

    def test_data_sheet_without_header_row_rejected(self):
        """A data (non-skip) sheet with no header_row raises ValidationError."""
        with self.assertRaises(ValidationError):
            SheetConfig(sheet_name="NoHeader", treat_as="data", skip=False)

    def test_skipped_sheet_needs_no_header_row(self):
        """A skipped sheet without header_row is valid."""
        s = SheetConfig(sheet_name="Summary", skip=True)
        self.assertTrue(s.skip)

    def test_master_preamble_sheet_needs_no_header_row(self):
        """A master_preamble sheet without header_row is valid."""
        s = SheetConfig(sheet_name="Preamble", treat_as="master_preamble")
        self.assertEqual(s.treat_as, "master_preamble")

    def test_two_qty_same_area_rejected(self):
        """Two qty columns for the same area in one sheet raises ValidationError."""
        with self.assertRaises(ValidationError):
            SheetConfig(
                sheet_name="MultiArea",
                header_row=1,
                area_dimensions=["B1"],
                column_role_map={
                    "D": ColumnRole(role="qty", area="B1"),
                    "E": ColumnRole(role="qty", area="B1"),
                },
            )


    # ------------------------------------------------------------------ #
    # Tests 15-16 — qty_by_area and amount_by_area require area            #
    # ------------------------------------------------------------------ #

    def test_qty_by_area_requires_area(self):
        """ColumnRole with role='qty_by_area' and no area raises ValidationError."""
        with self.assertRaises(ValidationError):
            ColumnRole(role="qty_by_area")

    def test_amount_by_area_requires_area(self):
        """ColumnRole with role='amount_by_area' and no area raises ValidationError."""
        with self.assertRaises(ValidationError):
            ColumnRole(role="amount_by_area")

    # ------------------------------------------------------------------ #
    # Tests 17-18 — qty_by_area and amount_by_area valid in SheetConfig    #
    # ------------------------------------------------------------------ #

    def test_qty_by_area_with_area_succeeds_in_full_sheetconfig(self):
        """SheetConfig with qty_by_area column referencing a declared area succeeds."""
        s = SheetConfig(
            sheet_name="MultiArea",
            header_row=1,
            area_dimensions=["B1", "B3", "B6"],
            column_role_map={"D": ColumnRole(role="qty_by_area", area="B1")},
        )
        self.assertEqual(s.column_role_map["D"].area, "B1")

    def test_amount_by_area_with_area_succeeds_in_full_sheetconfig(self):
        """SheetConfig with amount_by_area column referencing a declared area succeeds."""
        s = SheetConfig(
            sheet_name="MultiArea",
            header_row=1,
            area_dimensions=["B1", "B3", "B6"],
            column_role_map={"E": ColumnRole(role="amount_by_area", area="B1")},
        )
        self.assertEqual(s.column_role_map["E"].area, "B1")

    # ------------------------------------------------------------------ #
    # Test 19 — amount_combined is not area-compatible                     #
    # ------------------------------------------------------------------ #

    def test_amount_combined_role_does_not_accept_area(self):
        """amount_combined accepts no area (positive) and rejects area='B1' (negative)."""
        cr = ColumnRole(role="amount_combined")
        self.assertIsNone(cr.area)

        with self.assertRaises(ValidationError):
            ColumnRole(role="amount_combined", area="B1")

    # ------------------------------------------------------------------ #
    # Test 20 — GlobalSettings default reserved keywords                   #
    # ------------------------------------------------------------------ #

    def test_global_settings_default_reserved_keywords(self):
        """Default GlobalSettings has multi_area_reserved_keywords with baseline + Phase 2c expansion (120 entries)."""
        gs = GlobalSettings()
        keywords = gs.multi_area_reserved_keywords
        self.assertEqual(len(keywords), 120)
        for word in ("QTY", "AMOUNT", "TOTAL", "DESCRIPTION", "RATE",
                     "ITEM", "S NO.", "SL.NO.", "SR NO.", "SERIAL NUMBER",
                     "SUBJECT", "FLOOR", "DSR", "MAKE", "SUMMARY"):
            self.assertIn(word, keywords)

    # ------------------------------------------------------------------ #
    # Test 21 — Pattern-4 full mapping (integration)                       #
    # ------------------------------------------------------------------ #

    def test_pattern_4_full_mapping_validates_successfully(self):
        """Pattern-4 shape — per-area qty/amount + split supply/install rate + split supply/install total — validates without error."""
        config = MappingConfig(
            project="TEST-PROJECT",
            master_boq=_master_boq(),
            sheets=[
                SheetConfig(
                    sheet_name="PATTERN_4_TEST",
                    header_row=1,
                    header_row_count=1,
                    area_dimensions=["Office", "Common Area"],
                    column_role_map={
                        "A": ColumnRole(role="description"),
                        "B": ColumnRole(role="unit"),
                        "C": ColumnRole(role="qty_by_area", area="Office"),
                        "D": ColumnRole(role="amount_by_area", area="Office"),
                        "E": ColumnRole(role="qty_by_area", area="Common Area"),
                        "F": ColumnRole(role="amount_by_area", area="Common Area"),
                        "G": ColumnRole(role="rate_supply"),
                        "H": ColumnRole(role="rate_install"),
                        "I": ColumnRole(role="amount_supply"),
                        "J": ColumnRole(role="amount_install"),
                    },
                )
            ],
        )
        self.assertIsNotNone(config)
        sheet = config.sheets[0]
        qty_areas = sorted(cr.area for cr in sheet.column_role_map.values() if cr.role == "qty_by_area")
        self.assertEqual(qty_areas, ["Common Area", "Office"])


if __name__ == "__main__":
    unittest.main()
