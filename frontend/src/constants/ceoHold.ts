/**
 * The only user authorized to set or remove "CEO Hold" status on projects,
 * AND the only user authorized to promote a Project Payment from "CEO Pending" to "Approved".
 * Must match the backend constant in nirmaan_stack/constants/authorized_users.py.
 */
export const CEO_AUTHORIZED_USER = "nitesh@nirmaan.app";

/** @deprecated Use CEO_AUTHORIZED_USER. Kept as alias for back-compat with CEO Hold imports. */
export const CEO_HOLD_AUTHORIZED_USER = CEO_AUTHORIZED_USER;
