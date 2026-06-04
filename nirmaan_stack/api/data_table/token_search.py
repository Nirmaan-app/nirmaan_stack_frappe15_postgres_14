"""
Token-based scoring helper for ranking server-side item-search results.

Mirrors the algorithm in
`apps/nirmaan_stack/frontend/src/components/ui/fuzzy-search-select.tsx`
(`calculateMatchScore`) so backend ranking matches client-side
FuzzySearchSelect behavior:

  score = (matchRatio * 1000 + positionScore * 100) * fieldWeight
  isFullMatch (all tokens matched) → score *= 1.5
  Sort: isFullMatch DESC, matchedTokenCount DESC, score DESC

Pure functions — no Frappe dependencies. Caller groups rows by parent and
this helper picks best-per-parent score, then ranks.
"""

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, TypedDict


# Token separators: whitespace, hyphen, underscore, slash, parentheses.
# Use the same regex in search.py / facets.py so the SQL filter and the
# Python ranker tokenize identically. Item names like "GI-Wire 4mm" or
# "ITM/Lugs-10" split into useful pieces.
_TOKEN_SEPARATOR = re.compile(r"[\s\-_/()]+")

def tokenize(query: str) -> List[str]:
    """Split a search query into tokens. Drops empties."""
    if not query:
        return []
    return [t for t in _TOKEN_SEPARATOR.split(query) if t]


def _find_word_prefix(value: str, token: str) -> int:
    """Return the position of the first occurrence of `token` at a word
    boundary in `value` — i.e. at start of string or right after one of our
    separators (whitespace, -, _, /, parens). Returns -1 otherwise.

    "gi" matches "gi wire", "GI-Wire", "Big GI Wire" but NOT "galvanised".
    Both `value` and `token` are expected to be lowercased by the caller.
    """
    pattern = r"(^|[\s\-_/()])" + re.escape(token)
    m = re.search(pattern, value)
    if not m:
        return -1
    # m.group(1) is the captured boundary: empty string for start-of-string,
    # one character for a separator. Token starts right after it.
    return m.start(0) + len(m.group(1))


class _Score(TypedDict):
    score: float
    is_full_match: bool
    matched_token_count: int
    matched_token_indices: List[int]


def _score_row(
    row: Dict[str, Any],
    tokens: Sequence[str],
    fields: Sequence[str],
    field_weights: Dict[str, float],
) -> _Score:
    """Score one row across the given fields for these tokens."""
    matched = [False] * len(tokens)
    matched_token_count = 0
    total_score = 0.0

    for field in fields:
        value = str(row.get(field) or "").lower()
        if not value:
            continue
        weight = field_weights.get(field, 1.0)

        field_match_count = 0
        positions: List[int] = []

        for idx, token in enumerate(tokens):
            tok = token.lower()
            pos = _find_word_prefix(value, tok)
            if pos != -1:
                if not matched[idx]:
                    matched[idx] = True
                    matched_token_count += 1
                field_match_count += 1
                positions.append(pos)

        if field_match_count > 0:
            match_ratio = field_match_count / len(tokens)
            avg_position = sum(positions) / len(positions)
            position_score = 1.0 / (avg_position + 1)
            total_score += (match_ratio * 1000 + position_score * 100) * weight

    is_full_match = all(matched)
    if is_full_match:
        total_score *= 1.5

    matched_indices = [i for i, m in enumerate(matched) if m]
    return {
        "score": total_score,
        "is_full_match": is_full_match,
        "matched_token_count": matched_token_count,
        "matched_token_indices": matched_indices,
    }


def _is_better(a: _Score, b: _Score) -> bool:
    if a["is_full_match"] != b["is_full_match"]:
        return a["is_full_match"]
    if a["matched_token_count"] != b["matched_token_count"]:
        return a["matched_token_count"] > b["matched_token_count"]
    return a["score"] > b["score"]


def rank_parents_by_token_score(
    parent_names: Sequence[str],
    rows: Iterable[Dict[str, Any]],
    parent_key: str,
    query: str,
    fields: Sequence[str],
    field_weights: Optional[Dict[str, float]] = None,
) -> List[str]:
    """
    Rank parents by token-score across their searchable rows.

    parent_names : parents that survived the SQL filter (order preserved on ties).
    rows         : iterable of dicts; each must include parent_key + every field
                   in `fields`.
    parent_key   : dict key pointing to the parent name (e.g. "parent").
    query        : raw user search input.
    fields       : searchable text fields.
    field_weights: optional per-field weights; defaults to 1.0.

    Returns parent names sorted best-match first. Each parent's score is the
    BEST score across its rows (best-per-row, never averaged).
    """
    tokens = tokenize(query)
    if not tokens or not parent_names:
        return list(parent_names)

    weights = field_weights or {}
    parent_set = set(parent_names)
    parent_order_index = {name: i for i, name in enumerate(parent_names)}
    # parent-level token coverage (union of tokens matched across all its rows)
    parent_token_coverage: Dict[str, set] = {}
    # best row score per parent (used as a fine-grained tie-breaker)
    best_by_parent: Dict[str, _Score] = {}

    for row in rows:
        parent = row.get(parent_key)
        if not parent or parent not in parent_set:
            continue
        scored = _score_row(row, tokens, fields, weights)
        if scored["matched_token_count"] == 0:
            continue
        coverage = parent_token_coverage.get(parent)
        if coverage is None:
            coverage = set()
            parent_token_coverage[parent] = coverage
        coverage.update(scored["matched_token_indices"])
        current = best_by_parent.get(parent)
        if current is None or _is_better(scored, current):
            best_by_parent[parent] = scored

    def sort_key(name: str):
        # Rank purely on inclusion: how many query tokens this parent matched,
        # then how tightly they matched in-row, then original list order.
        # Token order in the query does NOT influence ranking — "FACE 3M" and
        # "3M Face" return the same order for the same matches.
        coverage = parent_token_coverage.get(name) or set()
        token_count = len(coverage)
        best = best_by_parent.get(name)
        best_score = best["score"] if best else 0.0
        # Tie-break: earlier in parent_names wins (negated so larger key wins).
        order_tiebreak = -parent_order_index.get(name, 0)
        return (
            token_count,        # 3 of 3 > 2 of 3 > 1 of 3
            best_score,         # field-position tiebreaker (in-row tightness)
            order_tiebreak,
        )

    return sorted(parent_names, key=sort_key, reverse=True)
