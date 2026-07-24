// The BoQ "Type" badge -- how a BoQ was created (`BOQs.origin`).
//
// ONE home for the origin -> {label, variant} mapping (ADR-0010 F1: a domain rule has one
// home, never a copy per surface). Every surface that shows the Type badge reads it here:
//   - BoqProjectTab  -- the project's BoQ list (Type column)
//   - BoqMasterPanel -- the "BoQ to revise" picker on the upload screen
// A third surface imports this; it does NOT re-declare the labels.

/** The `badgeVariants` subset the Type badge uses. */
export type OriginBadgeVariant = "outline" | "orange" | "purple";

export interface OriginBadge {
  label: string;
  variant: OriginBadgeVariant;
}

// `origin` is a read-only Select on BOQs whose DECLARED options are only "upload\ntemplate",
// but live rows also carry "revision" (written by the revised-BoQ flow) -- a Frappe Select's
// options are a UI hint, never a DB constraint, so the DATA is the authority here, not boqs.json.
const ORIGIN_BADGES: Record<string, OriginBadge> = {
  upload: { label: "Original Upload", variant: "outline" },
  revision: { label: "Revised Upload", variant: "orange" },
  template: { label: "Template", variant: "purple" },
};

/**
 * Resolve a raw `BOQs.origin` to its badge.
 *
 * Blank/null origin = a row created before the field existed, which is always an Excel upload
 * (owner call). An UNKNOWN value renders its raw string rather than an empty cell, so an origin
 * added later by another module stays visible instead of silently disappearing from the surface.
 */
export const originBadge = (origin?: string | null): OriginBadge => {
  const key = (origin ?? "").trim() || "upload";
  return ORIGIN_BADGES[key] ?? { label: key, variant: "outline" };
};
