### Pre-1.9o fixture additions (chore, no parser source touched)

Added 4 synthetic multi-area BoQ fixtures (V1/V2 variants of
two shapes, intentionally different) to feed Phase 1.9o
regression coverage and the expanded-subset diagnostic retest:

- `multi_area_single_header_v1.xlsx` --- 17-sheet multi-sheet
  single-area BoQ, 1-row headers; parser handles cleanly today.
- `multi_area_single_header_v2.xlsx` --- same shape as V1,
  file bytes differ; V1 cross-check fixture.
- `multi_area_merged_header_v1.xlsx` --- 13-sheet BoQ with a
  hybrid shape (2-col top-row merges over Supply/Installation
  pairs PLUS row-2 'Area 1'/'Area 2' labels); auto_guess
  assigns qty to two columns. Edge-case coverage.
- `multi_area_merged_header_v2.xlsx` --- 13-sheet BoQ with
  canonical Tier A-merged shape: 4-col top-row merges over
  {Qty | Supply rate | Install Rate | Amount} sub-header
  quadruples per area. Currently exhibits silent supply/install
  drop (qty/rate/amount columns unassigned) at hrc=1 and hrc=2.
  Strongest Phase 1.9o regression fixture.

Commit: a97ff170

Feeds: Phase 1.9o (Tier A-merged pattern recognizer +
reference-code keyword expansion) regression coverage, and
the expanded-subset diagnostic retest empirical surface.

