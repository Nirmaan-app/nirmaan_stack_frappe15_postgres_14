### Cluster B amendment -- DOC-0 default flip (formula wins silently when document ~= 0) (FRONTEND, view-layer, NO migrate, base tip ae2ef63f, 2026-06-27)

**ONE narrow exception to the D1 default, frontend-only.** `reconcile.ts` ONLY (no consumer edits, no backend, no migrate).

**The rule.** When the committed DOCUMENT amount is approximately ZERO (`amountsEqual(documentVal, 0)` -- the EXISTING shared
epsilon, no new const) AND the formula is a real number that diverges, the FORMULA value wins **SILENTLY**: the cell shows +
rolls up the formula value, with NO divergence badge, NO review-strip entry, NO chooser, NO override. Rationale: we upload
UNPRICED BoQs, so almost every amount cell is doc-0 -- a doc-0 amount is an absent/blank value, not a client-stated price, so
the computed amount is the right thing to surface. NON-zero document divergences are **UNCHANGED** (default document, badge,
strip, chooser, overridable). doc-0 + formula ~0 was already non-divergent (`amountsDiffer` false) -> unaffected.

**The implementation (the careful part -- value=formula BUT not-divergent, in one place).** `resolveDivergence` returns BOTH
"does it diverge?" (drives badge/strip/chooser) and "what value?" (drives display/totals). For doc-0 we need value=formula
but diverges=FALSE. The clean shape: **return the SAME `{ diverges: false }` a true non-divergence returns**, added as one
line BEFORE the choice branch:
```
if (!amountsDiffer(documentVal, formulaVal)) return { diverges: false };
if (amountsEqual(documentVal as number, 0)) return { diverges: false };  // DOC-0 -> formula wins, silent
if (choice === "take_formula") return { diverges: true, resolved: "take_formula", value: formulaVal };
return { diverges: true, resolved: choice ?? "unset", value: documentVal };
```
Every consumer already falls through to the formula value when not diverging, so this needs ZERO per-consumer special-casing:
- **Totals (`pricingRollup.rowOwnAmount`):** `if (recon.diverges) return recon.value; return formulaVal;` -> doc-0 hits the
  `return formulaVal` branch -> the formula value rolls up (NOT the document 0). MOVES TOTALS (intended).
- **Grid display + `ReconcileBadge` (`PricingGrid`):** `shownAmount` starts = `cell.value` (formula) and is only overwritten
  when `recon.diverges`; the badge/chooser render only when `recon.diverges` -> doc-0 shows the formula value, NO badge.
- **Review strip (`priceability.buildDivergenceEntries`):** lists a cell only when `recon.diverges && resolved === "unset"`
  -> doc-0 dropped.
Placed BEFORE the choice branch so the formula ALWAYS wins on doc-0 -- no keep-document path for the zero case (a stale stored
choice can't pin a doc-0 cell to 0).

**Safety.** The integrity guard stays balanced: Option-1 (tree) and Option-2 (flat) both read the same per-cell resolved
value via `ownByIdx`, so the flip shifts both identically -> no false amber banner (proven by a new rollup test asserting
`integrityErrors` is empty for a doc-0 set). Edge cases tested: doc-0 + real formula -> formula (diverges false);
negative-near-zero doc (-0.004) -> treated as zero (formula); small-but-outside-epsilon doc (0.5) -> NOT zero (UNCHANGED,
document default, divergent); doc-0 + null/NaN formula -> not divergent anyway; doc-0 IGNORES a stored keep_document/
take_formula choice. Backend untouched (it only persists explicit choice tokens; "unset" is never stored; export write-back
is rates-only and never reads amounts/choices).

**Tests + gates.** `reconcile.test.ts` +7 (the doc-0 describe block) + `pricingRollup.test.ts` +1 (doc-0 rolls up formula,
guard balanced). **vitest 341->349** (reconcile 12->19, pricingRollup 27->28), tsc 3175 (0 new in the touched files),
in-container Vite build exit 0, 2026-06-27. Two commits (feat + docs); NOT pushed (owner pushes after live-cert).

**Live-cert (pending Nitesh, 145/150/166).** Z1 an unpriced (doc-0) priced line shows the computed amount with NO violet
badge + is absent from the Review strip; Z2 its value flows into the Summary totals (not 0); Z3 a NON-zero document
divergence still shows the badge + strip entry + chooser and is overridable (unchanged); Z4 a near-zero doc (a few paise)
behaves like Z1; Z5 the Summary shows no false integrity (amber) banner with a mix of doc-0 and non-zero divergent cells; Z6
repeat Z1/Z2/Z3 on 145/150/166.

