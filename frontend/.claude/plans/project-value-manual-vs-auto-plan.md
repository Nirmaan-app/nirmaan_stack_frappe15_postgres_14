# Plan: Project Value — Manual vs Automatic (+ Add-PO decision step)

> **One line:** A project's headline value can come from one of two places — the **sum of its
> Customer POs** (Automatic, default, = today) or a **number typed by the team** (Manual, opt-in).
> One `Check` field decides it, per project. Everything is additive; nothing changes unless someone
> opts in.

- **Branch:** `man-proj-val` (off `develop`, was 0/0 at start).
- **Status:** implemented + typechecked. **Not merged. Migrate pending.**
- **Artifacts:** senior proposal (📋) + dev spec (🏗️). This file is the engineering plan/record.

---

## The fundamentals

Two headline fields on `Projects`: `project_value` (excl. GST), `project_value_gst` (incl. GST),
plus the `customer_po_details` child table. One new flag decides where the value comes from:

```
manual_project_value = 0  (default)  ->  value = Σ Customer PO rows, recomputed every save  (AUTOMATIC)
manual_project_value = 1             ->  value = what the team typed; POs never overwrite it  (MANUAL)
```

The guard lives in `Projects.before_save` and is written so that **flag = 0 is byte-identical to
develop's historical behaviour** (including zeroing on an empty PO list):

```python
def before_save(self):
    if not self.get("manual_project_value"):          # AUTOMATIC (default) — unchanged from before
        self.project_value     = sum(flt(d.customer_po_value_exctax) for d in self.get("customer_po_details", []))
        self.project_value_gst = sum(flt(d.customer_po_value_inctax) for d in self.get("customer_po_details", []))
    # MANUAL (flag = 1): skip entirely — the typed values stay.
```

---

## Stage 1 — Manual vs Automatic (base feature)

Lets the team choose the mode at create time and switch it later on the edit form.

| Area | File | Change |
|---|---|---|
| Doctype | `doctype/projects/projects.json` | New `manual_project_value` Check (default `"0"`) + field_order + modified bump |
| Guard | `doctype/projects/projects.py` | `before_save` opt-in guard (above) |
| Create API | `api/projects/_project_population.py` | Persist `manual_project_value` alongside the value fields |
| Seed-PO fix | `api/projects/add_customer_po.py` | `save(ignore_permissions=True)` — seed PO runs before User Permissions exist |
| Type | `types/NirmaanStack/Projects.ts` | `manual_project_value?: 0 \| 1` |
| Schema | `project-form/schema.ts` | Optional union, **default 0**, non-blocking (existing create flow unchanged) |
| Create UI | `project-form/steps/ProjectDetailsStep.tsx` | "Enter project value manually" checkbox → reveals enabled value inputs |
| Submit | `project-form/index.tsx` | Blank the values on the PO-driven path before submit |
| Review | `project-form/steps/ReviewStep.tsx` | Shows "Manual — … / Auto — from Customer POs" |
| Edit UI | `edit-project-form.tsx` | Same toggle so an existing project can switch modes (schema/defaults/reset/payload/UI) |

**Behaviour**
- Add Project: toggle **off** by default → today's flow (value from POs). Tick it → type the value.
- Edit Project: flip the mode any time. Off → value recomputes from POs on save. On → typed value stays.

---

## Stage 2 — Add-PO decision step (improvement)

When a PO is added to a project that is **already Manual**, don't silently ignore it — ask.

**Flow**
- **Automatic project** → Add Customer PO is **one step** (unchanged).
- **Manual project** → **two steps**: Step 1 = PO details (unchanged); Step 2 = a choice:
  - **Keep my project value as it is** *(default)* — record the PO, leave the value untouched.
  - **Switch to Customer PO totals** — flip the project to Automatic (`manual_project_value → 0`);
    value becomes the sum of all POs, now and for future POs.
  - plus a **← Back to PO details** link.

| Area | File | Change |
|---|---|---|
| API | `api/projects/add_customer_po.py` | New `override_manual_value` param; when truthy AND project is manual → set `manual_project_value = 0` before save (so `before_save` recomputes). Default keeps manual. |
| Hook | `data/tab/financials/useCustomerPOApi.ts` | `createCustomerPO(..., overrideManualValue=false)` sends `override_manual_value`; `CustomerPOProjectsDoc` type gained the field |
| Dialog | `components/AddCustomerPODialog.tsx` | `manualProjectValue` prop, step/choice state, manual-mode gate in `handleSubmit` (no premature upload), step-2 panel, step-aware header + button label |
| Card | `components/CustomerPODeatilsCard.tsx` | Passes the project's `manual_project_value` into the dialog |

**Design decision (owner-confirmed):** "override" = **permanent switch to Automatic** ("stops being the
typed number and instead becomes the total of the POs"), not a one-time recompute. Default choice is
**Keep** (the safe "just add the PO data" option). Nothing uploads/saves until step 2 is confirmed.
Scoped to **Add** PO only — editing a PO on a manual project leaves the value alone.

---

## Safety / why it's additive

1. **Off by default** — new field default `0`; every existing + new project starts Automatic (= today).
2. **`before_save` flag=0 branch is unchanged** from develop — the PO-driven flow is byte-identical.
3. **No data change on release** — `migrate` only adds a column; it does not re-save existing projects,
   so every current `project_value` is untouched (data-equivalence by construction).
4. **Non-manual PO flow unchanged** — Stage 2's step-2 only appears for manual projects.
5. **Reversible** — a project can move between modes any time (edit form, or the Stage-2 override).

---

## Verification (ran)

- Backend `py_compile`: clean (projects.py, _project_population.py, add_customer_po.py); `projects.json` valid JSON.
- Full project `tsc --noEmit`: **0 errors in any file this feature touched** (a clean result on
  `AddCustomerPODialog.tsx` also confirms the step-1/step-2 JSX is balanced). The only errors near the
  earlier files are 6 pre-existing develop errors (carpet_area ×2, WP-category mapping, setActiveSection,
  DraftResumeDialog, unused `Form` import) — proven unchanged from HEAD. **Zero new type errors.**

---

## Git state & staging (Stage 1 vs Stage 2)

`git status` in `apps/nirmaan_stack` currently splits along the two stages:

**Stage 1 — already staged (`M `):**
`projects.json`, `projects.py`, `_project_population.py`, `Projects.ts`, `schema.ts`,
`ProjectDetailsStep.tsx`, `project-form/index.tsx`, `ReviewStep.tsx`, `edit-project-form.tsx`.

**Stage 2 — unstaged (` M`), plus the Stage-2 half of `add_customer_po.py` (`MM`):**
`AddCustomerPODialog.tsx`, `CustomerPODeatilsCard.tsx`, `useCustomerPOApi.ts`, `add_customer_po.py`.

To stage the Stage-2 set (run yourself — I don't stage on your behalf):
```bash
cd apps/nirmaan_stack
git add \
  frontend/src/pages/projects/components/AddCustomerPODialog.tsx \
  frontend/src/pages/projects/components/CustomerPODeatilsCard.tsx \
  frontend/src/pages/projects/data/tab/financials/useCustomerPOApi.ts \
  nirmaan_stack/api/projects/add_customer_po.py
```

---

## Remaining steps

- [ ] `bench --site localhost migrate` (from the devcontainer) — adds the `manual_project_value` column.
- [ ] Data-equivalence check: existing `project_value` identical before vs after migrate (DIFF = 0).
- [ ] E2E: manual create → PO does not change value; manual project + Add PO → Keep vs Switch behave; auto project → single-step PO, value grows.
- [ ] Merge `man-proj-val` → `develop`.
