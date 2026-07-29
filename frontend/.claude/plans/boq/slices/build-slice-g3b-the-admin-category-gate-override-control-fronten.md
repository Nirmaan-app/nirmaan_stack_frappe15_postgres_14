## Build slice G3b (the admin category-gate override CONTROL -- frontend) COMPLETE

**What shipped.** G2b shipped the server override (`set_category_override` / `clear_category_override`, admin-only
via `_is_nirmaan_admin`) and G3a shipped the banner that DISPLAYS override state -- but there was no in-product way
to SET or CLEAR it (previously done only via a raw endpoint call). G3b wires the two contextual controls INTO the
existing category-gate banner (`SheetPricingPage.tsx`), admin-only, with NO new endpoint, gate, count, or copy
change. Pure wiring on top of G2b/G3a.

**Where the controls live (deliberately contextual, NOT a toolbar button).**
- **SET** -- in the LOCK-variant banner: an `Override the check` outline button opens a shadcn `Popover` (title
  "Override the category check", subtitle "Unlocks rate editing despite blank categories. Reason is optional.")
  holding an OPTIONAL reason `Input` (`maxLength={CATEGORY_OVERRIDE_REASON_MAX_LEN}`=250) + a live `N/250` counter
  + an `Override` action. **No "are you sure" step** -- the reason popover IS the interaction (owner ruling).
- **CLEAR** -- in the OVERRIDE-variant banner: a `Remove override` outline button, no confirmation (clearing
  re-locks, it fails safe).
- Both gated on the SAME `showCategoryOverrideControl` flag; **banners render for everyone**, controls do not.

**Decisions (owner-locked, recorded so they are not re-litigated).**
- **Admin check mirrors the server BY CONSTRUCTION, is CONVENIENCE ONLY.** New exported pure helper
  `canAdminOverride(role, userId)` = `role !== "Loading" && (userId === "Administrator" || role === "Nirmaan Admin
  Profile")`. `useUserData()` maps the Administrator user to role `"Nirmaan Admin Profile"`, so this matches
  `_is_nirmaan_admin` without importing it or minting a new def. The `role !== "Loading"` guard is LOAD-BEARING:
  the control must not FLASH in before the role resolves. **The server is authoritative;** the frontend/server
  role-source divergence is a KNOWN, owner-ACCEPTED trade-off.
- **Reason is OPTIONAL** (blank valid). New exported pure helper `normalizeOverrideReason(raw)` =
  `raw.slice(0, MAX).trim() || null` -- client cap is belt-and-braces (the `Input maxLength` blocks it too; the
  server caps as well -- BOTH, not either), and blank maps to `null` (server stores NULL).
- **The count keeps counting while the override is active** -- the banner still shows "N row(s) still has/have no
  category"; the override unlocks editing, it does not zero the count. Unchanged from G3a.
- On success both handlers call `mutate()` (the get_priced_rows refetch) -- the banner + rate-cell state flip with
  **NO page reload**. On failure (incl. `PermissionError`) the SERVER's message surfaces inline via the existing
  `saveError` banner (`getFrappeError(e) || fallback`) -- never swallowed, never replaced with generic copy;
  identical idiom to the file's proven lock/save handlers.

**DELETE MAP (override is temporary by design -- owner commitment: remove once classification engines cover all
disciplines).** One cut removes G3b: (1) the two exported helpers `canAdminOverride` + `normalizeOverrideReason` +
the const `CATEGORY_OVERRIDE_REASON_MAX_LEN`; (2) the `role` read + `showCategoryOverrideControl` derivation;
(3) the two `useFrappePostCall` handles `setCategoryOverrideCall`/`clearCategoryOverrideCall`; (4) the state trio
`overridePopoverOpen`/`overrideReason`/`overrideSubmitting` + the handlers `handleSetCategoryOverride` /
`handleClearCategoryOverride`; (5) the two `{showCategoryOverrideControl && (...)}` control blocks inside the
banner (revert each fragment back to a bare `<span>`). Every block carries a `G3b` / "Delete with the override"
marker. The whole G2b server override (endpoints + 4 `BoQ Sheet` fields) is removed separately per its own
condition.

**Tests.** 11 new vitest in `frontend/src/pages/boq-wizard/categoryOverrideControl.test.ts` covering the two pure
helpers (admin sees / non-admin does not / `Loading` + `Error` sentinels hide -- no flash / reason blank->null,
whitespace->null, trimmed pass-through, over-long capped, cap-before-trim, const==250). Component render is
manual-cert (project runs vitest in `node` env, no jsdom/@testing-library -- vitest.config.ts). Full suite
**931 passed** (920 + 11). Python `test_pricing` **229** + `test_cross_boq_carry` **49** UNCHANGED (no Python
edits). tsc --noEmit clean on the touched file. Residence check holding (no regressions).

**Browser live-cert (`admins@nirmaan.app`, admin; `BOQ-26-00086` / `INVERTER`, gate shut with 1 blank).**
- C1 SET control `Override the check` visible in the lock banner (bundle marker). C2 popover opens with reason
  input + `0/250` counter + `Override`. C3 counter live-updates to `39/250` as the reason is typed. C4 `Override`
  -> override banner replaces lock banner, **no reload** (a `window` sentinel survived). C5 override banner:
  "Category check overridden by admins@nirmaan.app on 26-Jul-2026. 1 row still has no category — rate editing is
  unlocked anyway." + `Remove override` control. C6 `Remove override` -> lock banner + SET control return, **no
  reload** (sentinel survived). C9 zero residual -- the `BoQ Sheet` override fields (`category_gate_override` /
  `_by` / `_at` / `_reason`) verified back to `0`/NULL after the clear.
- **C7 (non-admin sees neither control on-screen) NOT exercised** -- no non-admin account available in the env;
  covered by unit tests (`canAdminOverride` -> false for non-admin roles and for both resolve sentinels). **C8
  (live rejection surfaces the server message) NOT exercised live** -- no non-admin to trigger the server
  `PermissionError`; covered by the shared `getFrappeError(e) || fallback` idiom (identical to the proven
  lock/save handlers). Both honestly reported, not skipped-silently.

**OWED / follow-ups (unchanged):** **G2d** (clear the override on re-classify + the copy-forward carry-atomicity
test gap). The non-admin on-screen case (C7) and the live-rejection case (C8) remain to be exercised whenever a
non-admin account exists in the cert env.

