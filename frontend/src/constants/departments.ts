// src/constants/departments.ts
//
// Departments for people (`Nirmaan Users.department`) and assets (`Asset Master.department`).
// There is no fixed list (owner, 2026-10-12): the departments are whatever people's and assets'
// records hold (`useDepartmentOptions`), and HR adds a new one by giving it to someone.

import { ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE } from "./roles";

/** Label for "no department yet", in lists and filters. */
export const NO_DEPARTMENT_LABEL = "No department";

/**
 * Who may set or change a person's department. Mirrors `DEPARTMENT_EDIT_PROFILES` in
 * `nirmaan_stack/services/role_profiles.py`, which the server enforces.
 */
export const DEPARTMENT_EDIT_PROFILES: readonly string[] = [ADMIN_PROFILE, HR_EXECUTIVE_PROFILE, HR_LEAD_PROFILE];

/** True for Admin and HR (and the Administrator user). */
export const canEditDepartments = (role: string | null | undefined, userId: string | null | undefined): boolean =>
  userId === "Administrator" || (!!role && DEPARTMENT_EDIT_PROFILES.includes(role));
