// A multi-select status filter held in one URL param as a comma-separated list. Shared by the planning
// tabs' status filters (Work Plan `planningStatus`, Material Plan `materialStatus`).

/** The statuses named by a comma-separated URL param, in `allowed` order; names not in `allowed` are dropped. */
export const parseStatusParam = (param: string | null | undefined, allowed: readonly string[]): string[] => {
  const named = new Set((param ?? "").split(",").map((s) => s.trim()));
  return allowed.filter((s) => named.has(s));
};

/** The URL param for a selection, in `allowed` order; null (param removed) when nothing is picked. */
export const statusParamOf = (selected: Iterable<string>, allowed: readonly string[]): string | null => {
  const picked = parseStatusParam([...selected].join(","), allowed);
  return picked.length ? picked.join(",") : null;
};
