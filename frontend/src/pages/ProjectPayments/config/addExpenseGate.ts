/**
 * Who gets the Add Expense button (Project Expense / Non-Project Expense) on Project Payment &
 * Expense: the ONE rule (#1475). `renderRightActionButton` reads it for `/project-payments`.
 *
 * Mirrored server-side by `ADD_EXPENSE_PROFILES` in `nirmaan_stack/services/role_profiles.py`, which
 * `api/expenses/direct_expense.create_direct_expense` checks beside Frappe `create` on `Project Expenses`
 * and `Non Project Expenses` (#1495): about 16 other roles hold that DocPerm, so it alone was no
 * boundary. Keep the two lists in sync; this one only decides whether the button renders.
 *
 * - PMO Executive (#1475) holds it on its own role, not through the System Manager its profile
 *   also carries. It gains no approval or settle tab (2026-09-17 PMO access review).
 * - HR Executive saves only through the System Manager on its profile.
 * - HR Lead is OUT: its roles hold read only on both doctypes and no System Manager, so a dialog
 *   shown to it would fail on save. Widen this only together with a DocPerm.
 * - Project Lead and Project Manager reach the page but are not offered expense creation here. The
 *   Project Manager role also holds no `create` on either ledger (#1495).
 */

import {
    ACCOUNTANT_LEAD_PROFILE,
    ACCOUNTANT_PROFILE,
    ADMIN_PROFILE,
    HR_EXECUTIVE_PROFILE,
    PMO_EXECUTIVE_PROFILE,
    PROCUREMENT_PROFILES,
} from "@/constants/roles";

import type { PaymentsViewer } from "./paymentsTabSet";

const ADD_EXPENSE_PROFILES: readonly string[] = [
    ADMIN_PROFILE,
    ACCOUNTANT_PROFILE,
    ACCOUNTANT_LEAD_PROFILE,
    ...PROCUREMENT_PROFILES,
    HR_EXECUTIVE_PROFILE,
    PMO_EXECUTIVE_PROFILE,
];

/** True when this viewer is offered Add Expense on Project Payment & Expense. */
export function canAddExpense(viewer: PaymentsViewer): boolean {
    return viewer.userId === "Administrator" || ADD_EXPENSE_PROFILES.includes(viewer.role);
}
