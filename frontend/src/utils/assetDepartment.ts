// src/utils/assetDepartment.ts
//
// Department rules for the screens. Mirrors `normalize_department` and `department_move` in
// `nirmaan_stack/services/asset_department.py`; the server re-checks before saving, this copy only
// decides what the screens show (the reason box, the dropdown list). Departments are Nirmaan
// Department records, so a move compares the stored names exactly.

export const MIN_DEPARTMENT_REASON_LENGTH = 10;

export interface DepartmentMove {
  /** The asset's department before; null when it had none. */
  from: string | null;
  /** The person's department, which the asset moves to. */
  to: string;
}

/** Tidy a typed department name: trim it and collapse repeated spaces; an empty one becomes null. */
export function normalizeDepartment(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").split(/\s+/).filter(Boolean).join(" ");
  return cleaned || null;
}

/**
 * Two typed names that differ only in capitals or stray spaces ("projects " vs "Projects"). Used only
 * to stop HR adding a near-duplicate department; stored departments are compared exactly.
 */
export function sameDepartment(a: string | null | undefined, b: string | null | undefined): boolean {
  return (normalizeDepartment(a) ?? "").toLowerCase() === (normalizeDepartment(b) ?? "").toLowerCase();
}

/**
 * Null when the asset's department stays as it is (same department, or the person has none yet);
 * otherwise where it moves from and to.
 */
export function departmentMove(
  assetDepartment: string | null | undefined,
  personDepartment: string | null | undefined
): DepartmentMove | null {
  if (!personDepartment || personDepartment === assetDepartment) return null;
  return { from: assetDepartment || null, to: personDepartment };
}

/** A reason is needed only to move an asset OUT of a department it already belongs to. */
export const needsDepartmentReason = (move: DepartmentMove | null): boolean => !!move?.from;

/** Long enough to explain the move (spaces at the ends don't count). */
export const isDepartmentReasonValid = (reason: string | null | undefined): boolean =>
  (reason ?? "").trim().length >= MIN_DEPARTMENT_REASON_LENGTH;

/**
 * Whether Edit may change an asset's department: it may fill an empty one, or fix one on an asset
 * that was never assigned. Mirrors `can_edit_asset_department` on the server.
 */
export const canEditAssetDepartment = (oldDepartment: string | null | undefined, hasBeenAssigned: boolean): boolean =>
  !normalizeDepartment(oldDepartment) || !hasBeenAssigned;
