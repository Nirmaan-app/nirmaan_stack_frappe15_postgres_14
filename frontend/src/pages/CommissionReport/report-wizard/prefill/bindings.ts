// Closed allowlist of binding paths a template can use in `bind: "..."`.
// Each binding path must be present in BOTH this file AND the backend resolver
// at: nirmaan_stack/api/commission_report/get_report_prefill.py
//
// Adding a binding:
//   1. Append the key here (and document it in commissioning-report-templates.md).
//   2. Add the matching resolver entry in get_report_prefill.py.
//   3. Re-run bench --site localhost migrate (no — only schema; just restart bench).

export const ALLOWED_BINDINGS = [
    'project.project_name',
    'project.project_city',
    'project.project_state',
    'project.location.full',
    'project.project_start_date',
    'project.project_end_date',
    'project.project_type',
    'project.customer.company_name',
] as const;

export type BindingPath = typeof ALLOWED_BINDINGS[number];

export const isAllowedBinding = (path: string): path is BindingPath =>
    (ALLOWED_BINDINGS as readonly string[]).includes(path);
