// The DPR editor (MilestoneTab) keeps each tab's entries in sessionStorage under
// `project_{id}_date_{date}_zone_{zone}_tab_{header}`, and that browser copy wins over the server draft.
// Beside the tab keys it stores a marker naming the server draft the copy was loaded from, so the editor
// can tell when that draft was deleted, submitted or replaced by another user and must not be saved again.

/** Marker value for a browser copy that was started when the zone had no server draft. */
export const DPR_NO_DRAFT_REF = "none";

/** Why the browser copy no longer matches the server, which decides the dialog's wording. */
export type StaleDraftKind =
  /** The copy came from a draft that is no longer the zone's draft (deleted, submitted or replaced). */
  | "draft_gone"
  /** The copy was started with no draft, and meanwhile someone else saved one for this zone. */
  | "started_elsewhere";

/** Prefix shared by every sessionStorage key of one DPR: one project + report date + zone. */
export const dprSessionKeyPrefix = (projectId: string, dateString: string, zone: string | null): string =>
  `project_${projectId}_date_${dateString}_zone_${zone}_`;

/** Key of the marker naming the server draft the browser copy was loaded from. */
export const dprDraftRefKey = (projectId: string, dateString: string, zone: string | null): string =>
  `${dprSessionKeyPrefix(projectId, dateString, zone)}draft_ref`;

/**
 * Compares the stored marker with the zone's current server draft.
 * `null` means the browser copy is safe to keep: no marker yet (a fresh tab, or a copy from before the
 * marker existed), or the marker still names the server draft.
 */
export const getStaleDraftKind = (
  storedRef: string | null,
  serverDraftName: string | null,
): StaleDraftKind | null => {
  if (storedRef === null) return null;
  if (storedRef === DPR_NO_DRAFT_REF) return serverDraftName ? "started_elsewhere" : null;
  return storedRef === serverDraftName ? null : "draft_gone";
};

/**
 * Removes every tab entry and the draft marker of one DPR from `storage`, leaving other zones and dates.
 * Matches `{prefix}tab_` and the marker exactly, so zone "Tower" never clears zone "Tower_2".
 */
export const clearDprSessionData = (
  storage: Pick<Storage, "length" | "key" | "removeItem">,
  projectId: string,
  dateString: string,
  zone: string | null,
): void => {
  const prefix = dprSessionKeyPrefix(projectId, dateString, zone);
  const refKey = dprDraftRefKey(projectId, dateString, zone);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (key === refKey || key.startsWith(`${prefix}tab_`))) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
};
