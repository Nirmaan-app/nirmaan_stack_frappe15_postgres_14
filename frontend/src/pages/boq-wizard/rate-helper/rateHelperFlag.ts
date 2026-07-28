/**
 * U1 dev gate (guardrail G1 / spec item 8). The whole rate-helper chassis is reachable ONLY when
 * this is true. It is `import.meta.env.DEV` -- TRUE under `vite` / `yarn dev`, FALSE in a production
 * `vite build` -- so in a shipped bundle the feature does not exist (no button, no badges, no panel),
 * regardless of anything else. A localStorage kill-switch lets it be toggled OFF at runtime for
 * verification (V10) without a rebuild; it can only turn the feature OFF, never ON in prod.
 *
 * Evaluated ONCE at module load so it is a stable const (memo-shield safe): toggling the localStorage
 * key takes effect on the next page load, which is exactly the V10 cert flow.
 */
function computeEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem("nirmaan-rate-helper-off") !== "true";
  } catch {
    return true;
  }
}

export const RATE_HELPER_ENABLED: boolean = computeEnabled();
