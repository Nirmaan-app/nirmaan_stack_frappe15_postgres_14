# Material Test Certificates

A Material Test Certificate (MTC) is a vendor's test certificate filed against a Billable PO, with the billable lines
it certifies. On a PO page, under `PO Attachments`, the roles that may upload see `Upload Test Certificate`; the MTC
table offers View to everyone, Edit and Delete by role. Since #1731 Project Managers and Project Leads upload too, on
their own projects, and edit only the MTCs they uploaded; they never delete. Domain rules:
`.claude/context/domain/material-test-certificates.md`.

## Sub-features

- `mtc` by role, on a Billable PO that is not Merged, Cancelled or Inactive:
  - Project Manager: `Upload Test Certificate`; on another user's MTC `View certificate file` only; on their own
    `Edit certificate` and no `Delete certificate`.
  - PMO, Procurement Lead: Upload, Edit and Delete.
  - Accountant: no Upload; View only.
  - On a Non-Billable PO nobody gets Upload.

## How to get to it (user POV)

- Project Manager (no `Purchase Orders` in the sidebar): `Projects` -> the project -> `PO Summary` -> search by
  `PO ID` -> the PO link.
- PMO, Procurement Lead, Accountant: sidebar `Purchase Orders` -> `All POs` -> search by `PO ID` -> the PO link.
- On the PO page: `PO Attachments` opens the MTC table; `Upload Test Certificate` sits in the PO's action row.

## Driving it with drive.py

- **Whole walk.** `python3 -I BIN/walk_mtc.py <env> <out dir>`. It finds an unlocked Project Manager whose projects
  hold a Billable PO with another user's MTC, a Delivered Billable PO with none (picked fresh each run: the walk
  uploads to it) and a Non-Billable PO, and a PMO, Procurement Lead and Accountant who can open them. Parts:
  `mtc_pm`, `mtc_roles`; a part run leaves the stamp alone.
- **Upload.** In the dialog: `set_input_files` on its file input (the walk draws a one-page PDF at run time), the
  `Certificate Date` button then a past day's `gridcell`, the `Select all items` checkbox, then `Upload`.
- **Row actions.** A row is a `tr` holding the link `View certificate file`; its actions are the `aria-label`s
  `View certificate file`, `Edit certificate`, `Delete certificate`.
- **DB proof.** The walk reads `Material Test Certificate` for the PO after the upload; its `owner` is the PM.

## Gotchas

- `Upload Test Certificate` stays on the page but disabled once every billable line has an MTC: a count of the button
  is not "may upload" on a covered PO.
- The table shows the uploader's full name, never the MTC id (`MTC-26-…`).
- The 2026-11-17 backup holds 20 MTCs, all on few projects; a newer backup may hold a PM with none, and then the walk
  reports `mtc` not walked with that reason.
