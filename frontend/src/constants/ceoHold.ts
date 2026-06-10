/**
 * The only user authorized to set or remove "CEO Hold" status on projects,
 * AND the only user authorized to promote a Project Payment from "CEO Pending" to "Approved".
 * Must match the backend constant in nirmaan_stack/constants/authorized_users.py.
 */
export const CEO_AUTHORIZED_USER = "nitesh@nirmaan.app";

/** @deprecated Use CEO_AUTHORIZED_USER. Kept as alias for back-compat with CEO Hold imports. */
export const CEO_HOLD_AUTHORIZED_USER = CEO_AUTHORIZED_USER;

/**
 * Marker stored in Projects.ceo_hold_by when the cashflow cron auto-places a hold
 * (vs a real user email for a manual hold). Must match the backend constant
 * CEO_HOLD_SYSTEM_USER in nirmaan_stack/constants/authorized_users.py.
 */
export const CEO_HOLD_SYSTEM_USER = "System (Cashflow Cron)";
