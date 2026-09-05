/**
 * Roles allowed to add warehouse stock manually.
 *
 * Mirrors `ADMIN_ROLE` in `api/warehouse/add_warehouse_stock.py`. The backend
 * `_require_admin()` is the real boundary — this list only decides whether the
 * button renders. Keep the two in step.
 *
 * NOTE: the `Administrator` user is already resolved to
 * "Nirmaan Admin Profile" by `useUserData`, so it needs no separate entry.
 */
export const WAREHOUSE_ADD_STOCK_ROLES: readonly string[] = [
  "Nirmaan Admin Profile",
] as const;

/**
 * `doctype_ref` stamped on a ledger row written by a manual stock entry.
 *
 * Mirrors `MANUAL_LEDGER_REF` in `api/warehouse/add_warehouse_stock.py`. Not a
 * real doctype — a manual entry has no source document, and the Ledger tab
 * renders this string verbatim.
 */
export const WAREHOUSE_MANUAL_LEDGER_REF = "Manual Entry";
