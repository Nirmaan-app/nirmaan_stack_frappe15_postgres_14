/**
 * SLICE 12c -- two PURE rules about landing a stated number on a catalogue rung.
 *
 * Both are generic and neither names a category or a discipline: one resolves a stated value onto a
 * rung when the two are the SAME size written to different precision, the other builds a value that
 * is ABOVE the top rung out of two or more rungs. They are confined by KEY PRESENCE on the pricing
 * block (`size_match`, `compose`) exactly as `override_when` / `unit_factors` are -- a category that
 * declares neither is byte-identical to before this module existed, which is what keeps ADP unmoved.
 *
 * Nothing here reads config files, items or the DOM. Every number that steers a rule arrives as an
 * argument, so the rules are testable as tables.
 */

// ---------------------------------------------------------------------------------------------------------
// half-up rounding on binary floats
// ---------------------------------------------------------------------------------------------------------

/**
 * Round half-up to `dp` decimal places.
 *
 * ⚠️ THIS IS THE ONE PLACE IN THE SLICE WHERE THE OBVIOUS IMPLEMENTATION IS WRONG. 7/8" is
 * `22.224999999999998` in binary, so `(22.225).toFixed(2)` gives `"22.22"` and `Math.round` inherits
 * the same problem -- a `toFixed`-based match silently drops 7/8" off its own rung (22.23) and sends
 * it to the ladder, which buys the next size up. The epsilon is what lands it.
 */
export function roundHalfUp(x: number, dp: number): number {
  if (!Number.isFinite(x)) return NaN;
  const p = Math.pow(10, dp);
  const s = x < 0 ? -1 : 1;
  return (s * Math.floor(Math.abs(x) * p + 0.5 + 1e-9)) / p;
}

// ---------------------------------------------------------------------------------------------------------
// (1) size resolution -- the same size, written to different precision
// ---------------------------------------------------------------------------------------------------------

export interface SizeMatchSpec {
  /** The rounding depths to try, in order. Declared in config; `[2, 1]` is what Insulation uses. */
  dp: number[];
}

export interface SizeMatch {
  /** The catalogue rung the stated value resolved to. */
  rung: number;
  /** The depth that resolved it -- for the working line. */
  dp: number;
  /** True when the stated value already equalled the rung exactly. */
  exact: boolean;
}

/**
 * Resolve a stated size onto one of `rungs` by rounding BOTH sides half-up, trying each depth in
 * order. Returns null when no depth lands it -- the caller then falls through to the ordinary ladder,
 * which is what buys the next size up.
 *
 * ⚠️ A DEPTH THAT IS NOT COLLISION-FREE OVER THE RUNGS IS SKIPPED, not resolved arbitrarily. Two rungs
 * sharing a rounded key would make the match order-dependent -- the caller would get whichever rung
 * happened to be first in the array, and the figure would depend on catalogue row order. Silence here
 * means the ladder decides, which is a rule a pricer can read; a coin flip is not.
 */
export function resolveSize(stated: number, rungs: number[], spec: SizeMatchSpec | undefined | null): SizeMatch | null {
  if (!spec || !Array.isArray(spec.dp) || !spec.dp.length) return null;
  if (!Number.isFinite(stated) || !rungs.length) return null;
  for (const dp of spec.dp) {
    if (!Number.isFinite(dp) || dp < 0) continue;
    const keys = rungs.map((r) => roundHalfUp(r, dp));
    if (new Set(keys).size !== keys.length) continue; // not collision-free at this depth -- skip it
    const want = roundHalfUp(stated, dp);
    const i = keys.indexOf(want);
    if (i >= 0) return { rung: rungs[i], dp, exact: rungs[i] === stated };
  }
  return null;
}

/** Whether every rung has a distinct key at `dp`. Exported so a test can pin the catalogue's own depths. */
export function collisionFree(rungs: number[], dp: number): boolean {
  const keys = rungs.map((r) => roundHalfUp(r, dp));
  return new Set(keys).size === keys.length;
}

// ---------------------------------------------------------------------------------------------------------
// (2) composition -- a value above the top rung, built out of rungs
// ---------------------------------------------------------------------------------------------------------

export interface ComposeSpec {
  /** How far the composed total may sit from the stated value, in the axis's own unit. */
  tolerance: number;
  /** The most layers a composition may use. */
  max_layers: number;
  /**
   * OWNER C-R1 (2026-10-04): the rate key whose SUM breaks a tie that closeness could not --
   * "lowest insulation material cost (cost_insulation of the layers summed)". Declared in config so
   * no rate name is written in code; ABSENT leaves the deterministic fallback below deciding, which
   * is what every composition did before this key existed.
   */
  cost_key?: string;
}

export interface Composition {
  /** The rungs to buy, largest first. ALWAYS two or more -- see the warning below. */
  layers: number[];
  /** Composed total minus stated. Zero where the rungs sum exactly. */
  delta: number;
}

/**
 * Build `stated` out of two or more `rungs`, within `spec.tolerance`.
 *
 * Preference order, applied in full before returning: FEWEST layers, then SMALLEST |delta|, then
 * fewest distinct sizes, then largest-first lexicographically -- so the answer is a function of the
 * inputs alone and never of array order.
 *
 * ⚠️ A COMPOSITION MUST CARRY AT LEAST TWO LAYERS, AND THIS IS NOT A TIDINESS RULE. The first version
 * of this search allowed a one-layer result, and it turned a stated 26 into a single 25 -- which is
 * exactly the 26 -> 25 exception the owner refused ("then we dont make the excpetion"). One layer is
 * what the ordinary ladder already is, so a one-layer "composition" is that ladder wearing the
 * tolerance as a disguise: it can shave a stated value DOWN, which the ladder itself never does.
 * With the floor at two, 26 composes as 13 + 13 and nothing is silently shaved.
 *
 * ⚠️ THE TOLERANCE APPLIES ONLY HERE. Letting it reach the exact / next-size-up rules would make
 * 26 -> 25 legal again by the back door.
 */
export function composeSize(
  stated: number,
  rungs: number[],
  spec: ComposeSpec | undefined | null,
  /**
   * OWNER C-R1: the material cost of one rung, for the LAST tie-break. Null for a rung whose cost is
   * unknown, which makes the whole candidate unrankable by cost and leaves it to the fallback -- a
   * half-known comparison would rank a cheap-looking candidate above one whose cost nobody read.
   */
  costOf?: (rung: number) => number | null,
): Composition | null {
  if (!spec || !Number.isFinite(spec.tolerance) || !Number.isFinite(spec.max_layers)) return null;
  if (!Number.isFinite(stated) || !rungs.length) return null;
  const max = Math.floor(spec.max_layers);
  if (max < 2) return null; // two is the floor; a spec that forbids it forbids composing at all

  const sorted = [...new Set(rungs.filter((r) => Number.isFinite(r) && r > 0))].sort((a, b) => b - a);
  if (!sorted.length) return null;

  let best: Composition | null = null;
  const consider = (layers: number[]) => {
    const total = layers.reduce((a, b) => a + b, 0);
    const delta = total - stated;
    if (Math.abs(delta) > spec.tolerance) return;
    const cand: Composition = { layers: [...layers], delta };
    if (!best || betterThan(cand, best, costOf)) best = cand;
  };

  // depth-first over NON-INCREASING multisets, so `13 + 19` and `19 + 13` are the one candidate
  const walk = (start: number, chosen: number[]) => {
    if (chosen.length >= 2) consider(chosen);
    if (chosen.length >= max) return;
    const remaining = stated - chosen.reduce((a, b) => a + b, 0);
    for (let i = start; i < sorted.length; i++) {
      // prune: even filling every remaining layer with the largest allowed rung cannot reach the target
      const layersLeft = max - chosen.length;
      if (remaining - sorted[i] * layersLeft > spec.tolerance) break;
      chosen.push(sorted[i]);
      walk(i, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return best;
}

/** The summed cost of a candidate's layers, or null when any one of them is unknown. */
function costOfLayers(c: Composition, costOf?: (rung: number) => number | null): number | null {
  if (!costOf) return null;
  let total = 0;
  for (const r of c.layers) {
    const v = costOf(r);
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    total += v;
  }
  return total;
}

/**
 * OWNER C-R1 (revised, 2026-10-04): "within +-2 mm -> fewest layers -> CLOSEST to the stated
 * thickness -> if still tied, LOWEST insulation material cost". The tolerance is the FILTER (applied
 * by `consider`); this is the ranking, in that order.
 *
 * ⚠️ CLOSENESS COMES BEFORE COST, and the owner said so explicitly -- so Thermal Nitrile 30 takes
 * 16 + 13 (29, one off) over 19 + 9 (28) and 19 + 13 (32), whatever they cost. Cost only separates
 * candidates that are equally close, which is what makes Nitrile 38 take 13 + 25 (118 + 165 = 283)
 * over 19 + 19 (143 + 143 = 286): both are two layers and both land exactly on 38.
 *
 * The two older tie-breaks are KEPT below as the deterministic fallback -- a catalogue with no cost
 * key, or a rung whose cost nobody read, must still resolve to ONE composition rather than whichever
 * the walk happened to reach first.
 */
function betterThan(a: Composition, b: Composition, costOf?: (rung: number) => number | null): boolean {
  if (a.layers.length !== b.layers.length) return a.layers.length < b.layers.length;
  const da = Math.abs(a.delta), db = Math.abs(b.delta);
  if (da !== db) return da < db;
  const ca = costOfLayers(a, costOf), cb = costOfLayers(b, costOf);
  if (ca !== null && cb !== null && ca !== cb) return ca < cb;
  const ua = new Set(a.layers).size, ub = new Set(b.layers).size;
  if (ua !== ub) return ua < ub;
  for (let i = 0; i < a.layers.length; i++) {
    if (a.layers[i] !== b.layers[i]) return a.layers[i] > b.layers[i];
  }
  return false;
}
