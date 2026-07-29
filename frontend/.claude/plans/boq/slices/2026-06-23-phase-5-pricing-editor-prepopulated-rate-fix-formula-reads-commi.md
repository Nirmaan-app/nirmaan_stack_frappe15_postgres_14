### Phase 5 Pricing Editor -- Prepopulated-rate fix -- formula reads committed rates by non-zero value (FRONTEND, fix 2026-06-23)

**Why.** A real bug confirmed on real data (a three-BoQ DB peek): a formula IGNORED a PREPOPULATED committed rate (a
real non-zero value from the tender doc) -> the amount blanked until the user re-edited the rate. Root cause:
`lookupOperandValue`'s RATE branch gated the read on `isCellPriced` (the editor MARKER, `priced_by_area`/`priced_*`), not
on whether a usable value is present -- so a markerless committed rate read as missing (not_yet). The earlier
single-BoQ recon (145 only, all-zero) wrongly concluded "no prepopulated rates exist / unsafe"; the three-BoQ peek
proved **150 (Alorica)** carries 42 scalar non-zero committed rates (e.g. 'low side' row 12: combined 1120 / supply 880
/ install 240, NO marker) and **166 (VRF)** carries 28 per-area non-zero committed rates (e.g. 158400/152400/6000, 0
priced) -- the premise HOLDS.

**The fix (one rule, RATE branch only of `PricingGrid.lookupOperandValue`).** A RATE operand is USABLE when
`isCellPriced(row, rd)` OR the resolved committed value is a NON-ZERO finite number. Three exhaustive states: editor-priced
(marker set, ANY value incl. a deliberate 0) -> value (unchanged); committed NON-ZERO (e.g. 1120, no marker) -> value
(**THE FIX**); committed/absent 0.0 (no marker) -> undefined -> the formula blanks (not_yet, "needs a rate"). Only the
unmarked FALL-THROUGH changed (was `return undefined`); the draft path + the priced path are byte-for-byte unchanged.
**Owner-accepted tradeoff:** a genuinely-0 committed rate never editor-priced BLANKS rather than computes 0 (the safer
error; price it 0 through the editor to set the marker -> usable). **No new storage / no new flag** -- non-zeroness is the
distinguisher (there are no NULLs in the committed tier; every unfilled rate coerces to 0.0, so NULL-vs-0 is unavailable).

**SCOPE (load-bearing).** RATE branch ONLY -- the qty / plain-amount branch is untouched (a committed qty of 0 still
reads 0, NOT undefined -- the non-zero gate must not reach it). `isCellPriced` itself is UNCHANGED, so its 5 other
consumers (the no-formula pairing fallback, the cross-area prefill + cleanup, the priced emerald/amber tint) are
unaffected. The fix lives in the SINGLE shared `lookupOperandValue`, so it flows to BOTH the grid amount cell AND the
summary rollup (which calls the same lookup with `draftRates={}`) automatically -- `pricingRollup.ts`/`SummaryPanel.tsx`
SOURCE were NOT edited.

**Tests + gates.** Vitest **163 -> 170** (+7): `PricingGrid.test.ts` (+6) -- a non-zero committed rate (no marker) is
usable [THE FIX] / a committed 0.0 stays undefined / a deliberately-priced 0 returns 0 / a per-area non-zero committed
rate (the 166 case) / a draft still wins / the qty-0 scope guard (RATE-only) + two `evaluateAmountCell` e2e (non-zero
committed rates now COMPUTE; a 0.0 unpriced still BLANKS). `pricingRollup.test.ts` -- the summary-fix slice's
"saved-UNPRICED folds to 0" test had used NON-ZERO rates (3,4) which the fix now correctly makes usable; **updated** it to
use 0.0 (its true genuine-unfilled intent -> still folds to 0) + **added** a positive test proving the fix flows to the
summary (non-zero committed -> rolls up 35). tsc **3178 == baseline** (0 in touched files). Vite build exit 0. The grid
compute structure / rate-save / nav / color / remarks / backend UNTOUCHED.

