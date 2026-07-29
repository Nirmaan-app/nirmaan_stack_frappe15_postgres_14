### Module 3 Slice 3d-ii -- per-area-pair uniqueness fix

**Status:** COMPLETE (fix f541e428 + docs 3c5f8156). Frontend-only. File changed: `SheetConfigPanel.tsx` only (usedAreaPairs Map added). Parser tests 588 unchanged. tsc: 0 errors on boq-wizard files.

**Root cause:** Parser enforces that each (role, area) pair may appear on at most one column per sheet. The UI did not reflect this -- two columns could both be assigned `qty` + "Zone A". Fix adds `usedAreaPairs: Map<string, string>` (`"role|area"` → col) computed alongside `usedSingletons`. For each area option in the area dropdown, disabled when `usedAreaPairs.has("role|area") && usedAreaPairs.get("role|area") !== currentCol`. The current row's own area is never disabled (prevents locking the user out of their own assignment).

---

