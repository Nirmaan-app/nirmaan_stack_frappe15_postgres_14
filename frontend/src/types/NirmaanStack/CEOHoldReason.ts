/**
 * One active AUTOMATIC (system) reason a project is on CEO Hold.
 *
 * A standalone projection (one row per project+source) maintained by the backend
 * services/ceo_hold engine. The project's `status="CEO Hold"` is the derived mirror; these
 * rows carry the per-source "why". Manual (nitesh) holds are NOT represented here.
 * See docs/adr/0004-multi-source-ceo-hold.md.
 */
export interface CEOHoldReason {
  name: string;
  project: string;
  /** Which automatic condition placed the hold. */
  source: "cashflow" | "dn_pending";
  /** Live, human-readable reason refreshed each reconcile (e.g. "7 purchase orders awaiting delivery (limit 4)"). */
  reason_text?: string;
  /** When this reason was first recorded ("held since"). */
  set_at?: string;
}
