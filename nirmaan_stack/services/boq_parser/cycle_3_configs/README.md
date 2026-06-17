# cycle_3_configs

Hand-generated MappingConfig snapshots for the 8 locked cycle 3 validation
fixtures. Generated during the cycle 3 deep dive session (2026-05-25).

## Locked fixture set (8 projects)

- sg_hvac
- safron_hvac_2026_04_11
- inovalon
- bill_of_quantities
- alorica_pri_tech_hvac_2row_header
- alorica_pri_tech_hvac_1row_header
- snitch
- raheja_commerzone_hvac

multi_area_merged_header_v1 was DROPPED from the locked set per v5.26a
decision (2026-05-27). Its config file is absent from this folder.

## Usage

Pass this folder as --configs-dir to cycle_3_rerun.py:

    python -m nirmaan_stack.services.boq_parser.cycle_3_rerun \
      --configs-dir nirmaan_stack/services/boq_parser/cycle_3_configs \
      --fixtures-dir nirmaan_stack/services/boq_parser/tests/fixtures \
      --output-dir <output-path>

## Cross-references

- Plan doc: frontend/.claude/plans/boq-upload-plan.md sec 17.44
- Handover doc: cycle 3 deep dive section
- Runner: nirmaan_stack/services/boq_parser/cycle_3_rerun.py
