/**
 * Rate-helper runtime kill-switch (was the U1 dev gate, guardrail G1 / spec item 8).
 *
 * The whole rate-helper chassis is reachable ONLY when this is true. It DEFAULTS ON: the feature
 * now ships in a production `vite build` exactly as it runs under `vite` / `yarn dev`. The former
 * `import.meta.env.DEV` early return is GONE (owner ruling, always-on) -- and with it the property
 * that a shipped bundle could not contain the feature at all.
 *
 * What remains is an EMERGENCY OFF-LEVER, not a gate: setting the localStorage key
 * `nirmaan-rate-helper-off` to "true" turns the feature off without a rebuild. Two limits are
 * inherent and must not be mistaken for a company-wide switch:
 *   - it is PER-BROWSER and PER-USER (localStorage is scoped to one origin in one browser profile),
 *     so it can never turn the feature off for everyone;
 *   - it takes effect on the NEXT PAGE LOAD, because the value is evaluated once at module load.
 * Turning it off for everyone is a code change, not a setting.
 *
 * The try/catch fails OPEN: a browser that denies storage access gets the feature, never loses it.
 *
 * Evaluated ONCE at module load so it is a stable const (memo-shield safe) -- `RATE_HELPER_ENABLED`
 * is read at ~21 guard sites in SheetPricingPage.tsx, which all flip together precisely because they
 * read this one const. Do NOT make it per-call, and do NOT replace any guard site with its own
 * condition.
 *
 * STANDING OWNER RULE (2026-08-11): no dev-only gates, ever. Anything built here must work as-is in
 * production; `import.meta.env.DEV` must not gate a feature again.
 */
function computeEnabled(): boolean {
  try {
    return localStorage.getItem("nirmaan-rate-helper-off") !== "true";
  } catch {
    return true;
  }
}

export const RATE_HELPER_ENABLED: boolean = computeEnabled();
