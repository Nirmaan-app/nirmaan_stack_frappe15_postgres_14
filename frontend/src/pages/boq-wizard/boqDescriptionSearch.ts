// Shared fuzzy description matcher for the BoQ review workflow.
//
// Replaces the old case-insensitive substring (`.includes`) search in BOTH ReviewTree
// (the #159 find-&-filter) and SheetSearchView (the row-finder, also the RestructureModal
// parent-picker) with the SAME token-scoring algorithm the app-wide pickers use
// (`utils/tokenSearch`, the extracted FuzzySearchSelect core). One definition so the two
// surfaces never drift.
//
// Locked behaviour (see boq-upload-plan.md "Fuzzy description search"):
//   - AND semantics: every >=2-char token must match somewhere (minTokenMatches = tokenCount).
//   - partial tokens on ("cable" matches "cabling"); case-insensitive.
//   - min length 2: a <2-char query (or a query of only 1-char tokens) yields NO hits --
//     find-semantics, NOT tokenSearch's "empty query returns everything" default (the trap).
//   - Returns a MEMBERSHIP Set of the original item references. Each caller re-emits hits in
//     its own DOCUMENT order (so prev/next steppers walk top-to-bottom); tokenSearch's
//     relevance ranking is DELIBERATELY discarded.
import { tokenSearch } from "@/utils/tokenSearch";

const MIN_LEN = 2;

/**
 * Fuzzy-match `items` by `query` against the text returned by `getText`, returning the set of
 * matching ORIGINAL item references. Empty / sub-2-char queries (or queries with no >=2-char
 * token) return an empty set. The caller iterates its own ordered list and keeps `set.has(item)`
 * to preserve document order.
 */
export function fuzzyDescriptionMatchSet<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): Set<T> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_LEN) return new Set<T>();

  // MUST mirror the config's minTokenLength below: the AND-count (minTokenMatches) and the
  // matcher have to agree on which tokens count, or nothing ever matches.
  const tokenCount = trimmed.split(/\s+/).filter((t) => t.length >= MIN_LEN).length;
  if (tokenCount === 0) return new Set<T>();

  const projected = items.map((item) => ({ description: getText(item), __item: item }));
  const ranked = tokenSearch(projected, trimmed, {
    searchFields: ["description"],
    partialMatch: true,
    minSearchLength: MIN_LEN,
    minTokenLength: MIN_LEN,
    minTokenMatches: tokenCount, // AND: every >=2-char token must match
  });
  return new Set(ranked.map((p) => p.__item));
}
