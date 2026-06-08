// Token-based fuzzy search — extracted from the FuzzySearchSelect dropdown so
// table search inputs can rank rows the same way the NewPR item picker does.
//
// Algorithm: split the query into whitespace tokens; for each (item, field)
// pair, count how many tokens appear (substring or word-boundary), score by
// (matchRatio * 1000 + positionScore * 100) * fieldWeight, and add a 50%
// bonus when every token matched somewhere on the item. Items where no
// `searchFields` field carries any token are dropped.

export interface TokenSearchConfig {
  /** Object keys to search in (e.g. ["item_name", "category"]). */
  searchFields: string[];
  /** Minimum query length before scoring kicks in (default 1). */
  minSearchLength?: number;
  /** Default false — match is case-insensitive. */
  caseSensitive?: boolean;
  /** True (default): "act" matches "actuators". False: word-boundary only. */
  partialMatch?: boolean;
  /** Tokens shorter than this are ignored (default 1). */
  minTokenLength?: number;
  /** How to split the query into tokens (default whitespace). */
  tokenSeparator?: RegExp;
  /** Per-field weight; higher = ranks higher when matched (default 1 each). */
  fieldWeights?: Record<string, number>;
  /** Minimum tokens that must match for the item to survive (default 1). */
  minTokenMatches?: number;
}

interface ResolvedTokenSearchConfig {
  searchFields: string[];
  minSearchLength: number;
  caseSensitive: boolean;
  partialMatch: boolean;
  minTokenLength: number;
  tokenSeparator: RegExp;
  fieldWeights: Record<string, number>;
  minTokenMatches: number;
}

interface SearchMatch<T> {
  item: T;
  score: number;
  matchedTokenCount: number;
  isFullMatch: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFieldString(item: unknown, field: string): string {
  if (item == null || typeof item !== "object") return "";
  // Allow dot-paths like "project.name" so callers can search nested fields.
  const parts = field.split(".");
  let cur: unknown = item;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur == null ? "" : String(cur);
}

function resolveConfig(config: TokenSearchConfig): ResolvedTokenSearchConfig {
  return {
    searchFields: config.searchFields,
    minSearchLength: config.minSearchLength ?? 1,
    caseSensitive: config.caseSensitive ?? false,
    partialMatch: config.partialMatch ?? true,
    minTokenLength: config.minTokenLength ?? 1,
    tokenSeparator: config.tokenSeparator ?? /\s+/,
    fieldWeights: config.fieldWeights ?? {},
    minTokenMatches: config.minTokenMatches ?? 1,
  };
}

function scoreItem<T>(
  item: T,
  tokens: string[],
  config: ResolvedTokenSearchConfig
): SearchMatch<T> | null {
  const { searchFields, caseSensitive, partialMatch, fieldWeights, minTokenMatches } = config;

  const tokenMatched = new Array(tokens.length).fill(false);
  let totalScore = 0;
  let totalTokenMatches = 0;

  for (const field of searchFields) {
    const raw = getFieldString(item, field);
    const haystack = caseSensitive ? raw : raw.toLowerCase();
    const weight = fieldWeights[field] ?? 1;

    let fieldMatchCount = 0;
    const positions: number[] = [];

    tokens.forEach((tok, i) => {
      const needle = caseSensitive ? tok : tok.toLowerCase();
      let pos = -1;
      if (partialMatch) {
        pos = haystack.indexOf(needle);
      } else {
        const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, caseSensitive ? "" : "i");
        const m = re.exec(haystack);
        pos = m ? m.index : -1;
      }
      if (pos !== -1) {
        if (!tokenMatched[i]) {
          tokenMatched[i] = true;
          totalTokenMatches++;
        }
        fieldMatchCount++;
        positions.push(pos);
      }
    });

    if (fieldMatchCount > 0) {
      const matchRatio = fieldMatchCount / tokens.length;
      const avgPos = positions.reduce((a, b) => a + b, 0) / positions.length;
      const positionScore = 1 / (avgPos + 1);
      totalScore += (matchRatio * 1000 + positionScore * 100) * weight;
    }
  }

  if (totalTokenMatches < minTokenMatches) return null;

  const isFullMatch = tokenMatched.every(Boolean);
  if (isFullMatch) totalScore *= 1.5;

  return { item, score: totalScore, matchedTokenCount: totalTokenMatches, isFullMatch };
}

/**
 * Filter + rank `items` by `query` using the same token-scoring algorithm as
 * the `FuzzySearchSelect` dropdown. Returns input order untouched if `query`
 * is empty / shorter than `minSearchLength`.
 */
export function tokenSearch<T>(
  items: readonly T[],
  query: string,
  config: TokenSearchConfig
): T[] {
  const resolved = resolveConfig(config);
  const trimmed = query.trim();

  if (!trimmed || trimmed.length < resolved.minSearchLength) {
    return items.slice();
  }

  const tokens = trimmed
    .split(resolved.tokenSeparator)
    .map((t) => t.trim())
    .filter((t) => t.length >= resolved.minTokenLength);

  if (!tokens.length) return items.slice();

  const matches: SearchMatch<T>[] = [];
  for (const item of items) {
    const m = scoreItem(item, tokens, resolved);
    if (m) matches.push(m);
  }

  matches.sort((a, b) => {
    if (a.isFullMatch !== b.isFullMatch) return a.isFullMatch ? -1 : 1;
    if (a.matchedTokenCount !== b.matchedTokenCount) {
      return b.matchedTokenCount - a.matchedTokenCount;
    }
    return b.score - a.score;
  });

  return matches.map((m) => m.item);
}
