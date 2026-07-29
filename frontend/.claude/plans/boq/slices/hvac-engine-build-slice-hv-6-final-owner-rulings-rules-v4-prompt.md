## HVAC engine -- Build slice HV-6 (final owner rulings: rules v4 + prompt v1.3) COMPLETE

**Commits:** `20ef94da` (feat) + this docs commit. Branch `feature/boq-classification-eval`, base
tip `9623b129`. **Rules-only measurement; NO AI calls this slice.** HVAC engine registry stays OFF.

### The three final rulings

**1. CHW/DX boundary -- the FEED MEDIUM decides, never the form factor.** `cassette`, `hi-wall`,
`ductable`, `split` are FORM words describing the box, not the category. Water-fed (chilled water /
CHW / water-fed / water-cooled, and FCU by definition) -> `hvac_chw_units`; refrigerant-fed
(refrigerant / R410A / R32 / DX / condensing unit) -> `hvac_dx_unit`. **Context may come from the
line's own text OR its section header** -- this was the load-bearing correction: a first encoding
demanded co-location in the line's own text and broke 6 correct rows (`1.6 TR Cassette Ac` carries
its water context only in the ancestor). Bare form with NEITHER context stays LOW/contested on
purpose. Shipped as: `CHW-CASSETTE`/`DX-CASSETTE` restated as law, `CHW-ANC` widened with
`water fed`/`water cooled`, new **`DX-ANC`** (ancestor, 0.4) mirroring `CHW-ANC`, new
**`DX-VRF-EXCL`** (exclusion, `applies_to_ancestor: true`) giving VRF precedence.

**A measured negative, on the record:** the bare token `refrigerant` in `DX-ANC` was tried and
REJECTED -- VRF systems are refrigerant-fed too, so it stole VRF rows (-4). A regression test now
guards against reintroducing it.

**2. VRF controllers -> `hvac_vrf`.** A VRF/VRV system's own controls (corded/wireless remote,
centralised remote controller, Intelligent Touch Manager) price with the VRF package: new
**`VRF-CONTROLS`** (item_keyword regex, 0.55). Guarded the other direction by new
**`SNS-VRFCTRL-EXCL`** so Sensors keeps the BMS basket only (BACnet/BMS integration, transmitters,
thermostats). The discriminator is WHAT THE DEVICE CONTROLS.

**3. Misc -- UNCHANGED**, by explicit owner ruling. No Misc rule was touched.

### The PNL-ANC-TYPE grid -- and why NOTHING shipped

The Set-2 exam measured `PNL-ANC-TYPE` at 18.8% precision (16 fires) and flagged it for a fix.
Measured on the combined 2,354-row corpus, **every in-scope remedy is worse than keeping it**:

| option | in scope? | accuracy | delta | moved | fixed | broke |
|---|---|---:|---:|---:|---:|---:|
| **(0) keep as-is -- SHIPPED** | -- | **68.22%** | baseline | -- | -- | -- |
| (i) restrict to distance d=0 | **NO** -- needs a `runner.py` field | -- | -- | -- | -- | -- |
| (ii-a) delete `PNL-ANC-TYPE` | yes | 67.25% | **-0.98 pp** | 37 | 0 | **23** |
| (ii-b) delete it + `PNL-ANC` | yes | 67.33% | -0.89 pp | 40 | 2 | 23 |
| (iii) `headers_only: true` (+/- narrowed match) | yes | 68.01% | -0.21 pp | 10 | 0 | 5 |

Deleting the rule breaks **23 correct rows and fixes zero**: it is what resolves bare fragment
leaves (`For 15HP`, `22.38 kW`) under a panel header. The exam's 18.8% was a **Set-2-only**
measurement of the rule's own claims; on the full corpus it is net strongly positive. Both are
true. **AMBIGUITY SURFACED, NOT GUESSED:** option (i) is not implementable without a per-rule
distance field in `runner.py`, which was out of scope -- deferred to HV-7 with this grid as
evidence.

### Verification (rules-only, combined n=2,354, view ii)

**68.22% -> 68.39% (+0.17 pp).** 11 rows moved: **6 fixed, 2 regressed, 3 neutral**. Rows moving
OUTSIDE the ruling categories: **4, net +2** -- inside the declared 5-row stopping condition.
Ten of seventeen categories are bit-for-bit unchanged. DX Unit recall 0.0 -> 66.7 (first correct
rows in the corpus), Sensors precision 27.7 -> 30.2, Panels precision 51.1 -> 53.3, Cables recall
35.6 -> 37.6. **CHW Units did not move** -- the ruling is encoded and symmetric, but that pile's
exam fragility is a truth/boundary problem, not a weight problem.

**The 2 regressions** (`00029 / HVAC WORK` r384-385, `a. 12 HP nominal capacity`, truth VRF) are a
KNOWN LIMITATION accepted deliberately: `DX-VRF-EXCL` is ancestor-scoped and inspects only the
RESOLUTION POINT, so a VRF ancestor sitting *above* a DX-worded header is invisible to it. A
whole-chain exclusion would need a runner mechanism -- deferred. Net trade +6/-2, so it ships.

Full tables, verbatim traces and the electrical proof:
`_classification_review/hvac_rules_v4_verify/VERIFY_V4.md`.

### Tests

`test_runner_hvac.py` **79 -> 92 (+13)**: CHW/DX positives both directions, the bare-form-factor
NEGATIVE (no context -> not HIGH/MED), VRF precedence at the resolution point, the `refrigerant`
regression guard, `CHW-ANC` water vocabulary, two VRF-controller positives, two BMS-side
negatives, rules version `4.0-hv6` + the four new rule ids, the `PNL-ANC-TYPE` retention decision,
and prompt v1.3 carrying both discriminators. `test_runner_electrical.py` **82 -> 82 lock held**,
`test_decay.py` 12 -> 12, `test_hv2_voter_harness.py` 14 -> 14. **Suite 187 -> 200, all green.**

**A10 electrical proof:** `rules_electrical.json` untouched; all verdicts over the **1,384** tracked
electrical corpus line items hash IDENTICALLY across the change (`818dd8f1...1a5f`, 0 rows differ).
Method: classify with the working tree, then again with `rules_hvac.json` reverted to HEAD bytes.
*(In-repo corpus; the full 2,888-row labelled set lives outside the repo and was not re-run.)*

**KNOWN pre-existing failure, OUT of scope, unchanged:** `TestMigrateWorkPackageToMulti` in
`api/boq/wizard/test_update_sheet_draft.py` (3 errors of 82).

### NO UNSEEN DATA LEFT -- the next honest eval is production Set-3

Set-1 and Set-2 are both spent. Every remaining number on this corpus is in-sample. **Nothing
further should be tuned against it** -- the Set-2 exam's verdict (further ruleset tuning fits
noise) is now doubly binding, and this slice deliberately made NO weight changes and did NO new
mining. Carried to HV-7: (1) prompt v1.3 is UNMEASURED and must be certified; (2) the
`PNL-ANC-TYPE` distance restriction; (3) the `DX-VRF-EXCL` whole-chain variant; (4) the routing
policy from the exam's frontier (owner-selected variant: `AGREE AND conf >= 0.80` demoting
Cables/Ducting/Sensors); (5) the blank-`final_category_id` review policy. Registry stays OFF.

