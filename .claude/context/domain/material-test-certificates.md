# Material Test Certificates (MTC) — Reference

A Material Test Certificate (MTC) is a vendor's test certificate filed against a Purchase Order. Each one holds one
file and the **billable PO lines** it certifies.

Users work with MTCs in two places:
- a card in the PO page's "PO Attachments" section, where certificates are uploaded, edited and deleted;
- a list page reached from the Project Manager and Project Lead dashboards (`/prs&milestones/material-test-certificates`).

The full decision log (owner rulings Q1–Q39) and the build notes are in
`frontend/.claude/plans/material-test-certificate-plan.md`.

## Load-bearing invariants (owner-locked)

- **The status rule has one home on each side, and the two must change together:** `services/mtc_rules.py`
  (`po_block_reason`, `MTC_BLOCKED_STATUSES`) and `frontend/src/utils/mtc.ts` (`isPoOpenForMTC`).
  - An MTC can be uploaded, edited or deleted on a **Billable** PO in any status **except Merged, Cancelled and
    Inactive** (owner ruling Q39, which replaced "Partially Delivered / Delivered only").
  - If only one side changes, the screen offers buttons the server refuses, or hides buttons it would allow.
- **The controller is the only enforcement**, for every write path: the SDK create, `update_mtc`, Desk and delete.
  The file is `integrations/controllers/material_test_certificate.py`, with `validate` and `on_trash`.
  - The role gate is the **profile** check `role_profiles.can_manage_mtc`: Admin, PMO and all four Procurement
    profiles.
  - The doctype's Role rows cannot say this: `System Manager` and `Nirmaan Procurement Executive` also ride on the
    Project Lead profile, which must not change MTCs.
- **One PO line per MTC per PO.**
  - A line is `(item_id, make)`, built by `mtc_rules.line_key`.
  - `validate` locks the PO row (`SELECT … FOR UPDATE`) before checking other MTCs, so two uploads at the same
    moment cannot claim the same line.
  - A **saved** row may stay after a PO revision removes its line or makes it Non-Billable (owner ruling Q14).
    Every **new** row must be a Billable line on the PO.
- **Certificate Date is required and never in the future.** One rule on each side:
  `mtc_rules.certificate_date_problem` (enforced in `validate`) and `utils/mtc.ts` `certificateDateProblem`
  (dialog). There is no default; the user reads the date off the certificate (owner).
- **MTC ids (`MTC-26-00001`) are never shown to users,** whether in tables, dialog titles, toasts, tooltips or
  server error messages (owner). `mtc.name` is used only as a key and in API calls.
- **Derived fields always come from the PO, never from the client.** These are `project` and `vendor` on the
  parent, and `item_name`, `make`, `category` and `procurement_package` on each row.
- **Project scope reads the PROFILE, never `has_role_profile`.**
  - `mtc_api.mtc_allowed_projects` limits a PM or PL to their own `User Permission` rows on Projects. **No rows
    means nothing**, deliberately stricter than Frappe's default of "everything".
  - `has_role_profile` also matches Role names, and Administrator holds every Role, including ones named like the
    PM and PL profiles. Through that helper, Administrator would be scoped down to nothing.
- **Project assignment does not gate the upload.** Frappe checks create permission before `validate` copies the
  project from the PO, so a buyer's project restrictions never see it. DC/MIR behaves the same way, because its
  endpoint skips permissions entirely. The PO page itself is the project gate.
- **Files are never removed from cloud storage by MTC code.**
  - **Delete** does what the DC/MIR delete does: a raw `frappe.db.delete("File", {file_url, attached_to_name: po})`,
    which skips `File.on_trash` and so keeps the cloud object (owner ruling Q34).
  - **Edit with a new file** leaves the old `File` row alone (owner ruling Q31).
  - Do not switch either to `frappe.delete_doc("File")`: that fires the `frappe_gcp_attachment` hook and deletes
    the object.
- **A PO that is cancelled, deleted or merged takes its MTCs with it.**
  - `controllers/procurement_orders.cleanup_po_linked_docs` and `api/po_merge_and_unmerge.handle_merge_pos` call
    `delete_mtcs_for_po`.
  - These deletes set `flags.from_po_cleanup`, which skips the role and status checks in `on_trash`.
  - MTCs can now exist on PO Approved POs (Q39), and PO Approved is where merge and cancel happen. **Whether a
    merge should instead be blocked, or move the MTCs, is with the owner.**
- **Indexes need explicit names.** On Postgres, `search_index` and `add_index` default to index names (`project`,
  `procurement_order`, `parent_index`) that already exist on other tables. Since index names are schema-wide,
  `CREATE INDEX IF NOT EXISTS` then creates nothing. Both doctypes therefore declare
  `mtc_procurement_order_index`, `mtc_project_index` and `mtc_item_parent_index` in `on_doctype_update`.
- **Handover Documents read MTCs.** HOD row 14 "Factory Test Reports" lists a system's MTCs through
  `api/hod/from_app.mtc_for_system`: an item's `procurement_package` must equal the HOD System's `work_package`
  (both masters share the names), with keywords on the shared Critical Room ELV package. The binder merges each
  ticked MTC's file. It is read-only, but renaming or dropping `procurement_package`, `certificate_date` or
  `attachment` breaks HOD.
- **Edits go through the `update_mtc` endpoint,** never a raw `updateDoc` (residence rule F5). It saves with
  `ignore_version=False`, so the edit history (`track_changes`) is written, and tested.
- **The list page's project picker is the plain shared `ProjectSelect`,** used exactly as on the DC & MIR page
  (selection shared through `UserContext` and session storage). `project-select.tsx` must not be changed for MTC
  (owner).

## Data model

**`Material Test Certificate`**
- Naming `MTC-.YY.-.#####`, e.g. `MTC-26-00001`. It restarts every 1 January, because Frappe keeps one counter
  per prefix and the year is in the prefix. It follows the calendar year, not the financial year. Past 99,999 in
  a year it simply grows a digit.
- `track_changes: 1`.
- Fields:

| Field | Type | Notes |
|---|---|---|
| `procurement_order` | Link → Procurement Orders | reqd, `set_only_once` |
| `project` | Link → Projects | reqd, read-only, copied from the PO |
| `vendor` | Link → Vendors | read-only, copied from the PO |
| `attachment` | Attach | reqd; a private file attached to the **PO**, as DC/MIR files are |
| `certificate_date` | Date | reqd; the date printed on the certificate; never in the future |
| `items` | Table → Material Test Certificate Item | at least 1 row |

**`Material Test Certificate Item`** (child table): `item_id` (reqd), plus `item_name`, `make`, `category` and
`procurement_package`, all copied from the PO line. It has no quantity.

**DocPerm:**
- Read: every role that reads Procurement Orders.
- Create, write and delete: System Manager, PMO, Procurement Executive and Procurement Lead roles.
- The profile check above is what actually decides.

## Where the code lives

| Piece | File |
|---|---|
| Line and status rules (pure) | `nirmaan_stack/services/mtc_rules.py` |
| Role constants and `can_manage_mtc` | `nirmaan_stack/services/role_profiles.py` (`MTC_MANAGE_PROFILES`, `MTC_PROJECT_SCOPED_PROFILES`) |
| Controller (`validate`, `on_trash`, `delete_mtcs_for_po`) | `nirmaan_stack/integrations/controllers/material_test_certificate.py`, wired in `hooks.py` |
| Endpoints `get_mtcs`, `get_mtc_projects`, `update_mtc` | `nirmaan_stack/api/material_test_certificates/mtc_api.py` |
| Tests | `nirmaan_stack/nirmaan_stack/doctype/material_test_certificate/test_material_test_certificate.py` |
| Rules, client copy (+ vitest) | `frontend/src/utils/mtc.ts`, `mtc.test.ts` |
| Role constants, client copy | `frontend/src/constants/roles.ts` (`MTC_MANAGE_PROFILES`, `canManageMTC`, `MTC_PAGE_PROFILES`) |
| PO page card, dialog, tables | `frontend/src/pages/MaterialTestCertificates/components/` |
| List page and hooks | `frontend/src/pages/MaterialTestCertificates/` (`MaterialTestCertificates.tsx`, `hooks/useMTCs.ts`, `hooks/useMTCMutations.ts`) |
| Hook-up points | `DocumentAttachments.tsx` (card), `PurchaseOrder.tsx` ("MTCs: n"), `dashboard-pm.tsx`, `dashboard-pl.tsx`, `routesConfig.tsx` (`RoleRoute` for PM and PL) |

**Reads:**
- `get_mtcs(procurement_order | project)` takes exactly one argument. It returns each MTC with its items,
  `vendor_name` and `procurement_request`. The PR is needed for the PM-side PO link,
  `/prs&milestones/procurement-requests/<pr>/<po>`.
- The PO header count and the card share the SWR key `mtcPoKey(po)`, so they make one fetch.

**Writes:**
- Create: upload the file (attached to the PO, private), then the SDK `createDoc`.
- Edit: `update_mtc`.
- Delete: the SDK `deleteDoc`.

## Screens

- **PO page → PO Attachments → "Material Test Certificates"**
  - Shown to everyone who sees the DC & MIR card, on **Billable POs only**. A Non-Billable PO never shows the card,
    even when MTCs exist; those still appear on the list page.
  - The accordion header shows "MTCs: n".
  - Upload, Edit and Delete appear only for the managing profiles, and only under the status rule. Otherwise the
    card is read-only.
  - Columns: S.No · Certificate Date · Uploaded On · Items · Uploaded By · Actions.
  - **Upload / Edit dialog**, in this order:
    - The title, with PO number and vendor under it.
    - The file and the Certificate Date side by side. The file shows as a neutral chip once picked. The date uses
      the app's `Calendar` popover, shown as dd-MMM-yyyy, with future days disabled and no helper text.
    - The items: a search box, "All items", and **one plain list**, with no category or package grouping
      (owner Q42). Each row is the item name and make. Only billable lines without an MTC are listed,
      and a note counts the ones held by other certificates.
    - The footer says why Upload is disabled. When every line is covered, Upload is greyed out
    with "All billable items have an MTC". Edit can replace the file and untick or tick items, keeping at least one.
- **MTC list page (PM and PL only)**
  - The project picker, a search over PO and items, and a summary line (certificates, POs, items) that follows
    the filters.
  - **The app's standard `DataTable` (`components/data-table/new-data-table`)**, fed a client-side TanStack table
    (`components/MTCProjectTable.tsx`). One project's MTCs are already loaded, so search, filters, sorting and
    paging all run in the browser.
  - Columns:
    - **PO No.**, sortable; the toolbar search covers "PO No." and "Item".
    - **Vendor**, with a facet filter.
    - **Items**, one per line.
    - **Certificate Date**, with the standard date filter (`dateFilterFn`) and sortable; the default sort is newest
      first.
    - **Uploaded By**, with a facet filter.
    - **MTC Attachment** ("View").
  - There is **no Uploaded On column** (owner). Phones scroll the same table sideways, with no cards.
  - It is view only.
  - A PM or PL with no assigned project sees "You have not been assigned any project".

## Testing

Run only this module. The site's DB is live; the tests roll back, stub commits, and evict the user-permission cache
for any user they touch.

```bash
bench --site localhost run-tests --skip-before-tests --skip-test-records \
  --module nirmaan_stack.nirmaan_stack.doctype.material_test_certificate.test_material_test_certificate
```

Frontend rules: `yarn test src/utils/mtc.test.ts`.
