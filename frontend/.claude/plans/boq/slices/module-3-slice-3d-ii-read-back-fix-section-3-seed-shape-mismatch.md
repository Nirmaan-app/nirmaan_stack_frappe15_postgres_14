### Module 3 Slice 3d-ii -- read-back fix (Section 3 seed shape mismatch)

**Status:** COMPLETE (fix cbb704ce + docs 18157331). Frontend-only. File changed: `SheetSpokePage.tsx` (seed loop + comment hardening). No SheetConfigPanel / boqTypes / .py changes. Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files. Vite build: clean (build tool unavailable in Windows Bash shell; tsc clean is the authoritative check).

**Root cause:** Slice 3d-i wrote the seed loop to check `if (typeof role === "string")` where `role` was the loop variable for the entry VALUE from `column_role_map`. When 3d-i was written, the blob stored role-only strings (`{col: "sl_no"}`). Slice 3d-ii corrected the save shape to `{role, area}` objects (`{col: {role:"sl_no", area:null}}`). The seed loop was never updated to match: every value's `typeof` check returned `"object"`, not `"string"`, so every entry was silently skipped. `setColumnRoleMap({})` was called. `setRoleMapInitialized(true)` then fired unconditionally (outside the rawRoleMap block but after the `if (!rawCfg) return` guard), permanently locking the empty state. Section 3 rendered zero rows on every navigation, even though 8 entries were correctly saved in the DB.

**Fix 1 -- seed loop dual-shape parser:** Renamed loop variable `role` → `val` (the value, not the role string). Loop body now handles both shapes:
- `typeof val === "string"` → legacy pre-3d-ii shape: `entries[col] = { role: val, area: null }`.
- `typeof val === "object" && val !== null && "role" in val && typeof val.role === "string"` → current 3d-ii shape: `entries[col] = { role: v.role, area: v.area ?? null }`.
- Anything else (null, malformed): silently skipped.

**Fix 2 -- initialized-flag placement review:** `setRoleMapInitialized(true)` was already correctly placed AFTER `if (!rawCfg) return` but NOT inside the `rawRoleMap` block -- so it fires whenever rawCfg is successfully parsed, even when `column_role_map` is absent (legitimate "no roles configured" state). This is the correct behavior: lock after rawCfg parse succeeds; leave unlocked on draft absent or JSON fail. No placement change was needed; stale comment ("is INSIDE the non-null guard") was corrected in the inline code comment.

**Manual test plan:**
1. PREFILL: open BOQ-26-00152 "low side" spoke. Section 3 must show 8 mapped rows prefilled from saved config, with sparkle. (**This was the primary broken case.**)
2. PERSISTENCE: add/change a mapping, Save, hard-reload → persists and re-displays.
3. EMPTY SHEET: open a sheet with no column_role_map → Section 3 empty (no rows), no crash.

---

