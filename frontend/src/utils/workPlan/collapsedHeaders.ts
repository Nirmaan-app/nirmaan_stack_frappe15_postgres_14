// The Work Plan's folded work headers ("HVAC Ducting", …): which ones are collapsed, the "Collapse all" button,
// and remembering the choice per project in this browser. The rules are pure (F4); only `loadCollapsedHeaders` /
// `saveCollapsedHeaders` touch localStorage, and both survive it being unavailable (private window, blocked
// storage): the page then just starts with every header open.

import { parseJson } from "@/lib/parseJson";

/** True when every shown header is collapsed (and at least one is shown): the button then reads "Expand all". */
export const allCollapsed = (collapsed: ReadonlySet<string>, shown: string[]): boolean =>
  shown.length > 0 && shown.every((header) => collapsed.has(header));

/**
 * The "Collapse all" / "Expand all" button: when every shown header is collapsed, open them all; otherwise collapse
 * them all. Headers not shown now (another zone, filtered out) keep their own state.
 */
export function toggleAllHeaders(collapsed: ReadonlySet<string>, shown: string[]): Set<string> {
  const next = new Set(collapsed);
  if (allCollapsed(collapsed, shown)) shown.forEach((header) => next.delete(header));
  else shown.forEach((header) => next.add(header));
  return next;
}

/** One header's arrow: collapse it if open, open it if collapsed. */
export function toggleHeader(collapsed: ReadonlySet<string>, header: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(header)) next.delete(header);
  else next.add(header);
  return next;
}

const storageKey = (projectId: string) => `nirmaan.workPlan.collapsedHeaders.${projectId}`;

/** The project's collapsed headers as saved in this browser; an empty set when nothing (readable) is saved. */
export function loadCollapsedHeaders(projectId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    const parsed = raw ? parseJson(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : []);
  } catch {
    return new Set();
  }
}

/** Save the project's collapsed headers in this browser; a failure only means the choice is not remembered. */
export function saveCollapsedHeaders(projectId: string, collapsed: ReadonlySet<string>): void {
  try {
    if (collapsed.size === 0) window.localStorage.removeItem(storageKey(projectId));
    else window.localStorage.setItem(storageKey(projectId), JSON.stringify([...collapsed]));
  } catch {
    // Storage unavailable: the page works, the fold is just not remembered.
  }
}
