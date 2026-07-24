// Pricing Module workbook registry (PW-1).
//
// THE single source of truth for "which pricing workbooks exist as pages":
// the generic page resolves its own identity from here (by route path), the
// route entries in routesConfig.tsx mirror these paths, and the sidebar spread
// in NewSidebar.tsx is generated from this list. Adding a fourth workbook page
// = one entry here + one route entry + the sidebar's three key/label touches.
//
// `title` is the LOAD-BEARING field: it is matched against the `title` column
// returned by list_workbooks to select THIS page's workbook (PW-1 replaced the
// old rows[0] pick, which -- with list_workbooks ordering by `modified desc`
// -- silently changed which workbook opened as people saved). It is also the
// title used when importing a workbook from this page's empty state, so it
// must match the Pricing Workbook doctype's unique `title` exactly.
//
// `path` is a SINGLE top-level segment by design: the sidebar's active-item
// matching is single-segment (`location.pathname.slice(1).split("/")[0]`, then
// `/${selectedKeys} === subitem.key`), so a nested path like /pricing/hvac
// would never highlight. Each path is also its OWN route object, which
// guarantees a real unmount when switching between workbooks -- the Luckysheet
// engine is a global singleton and the server-side checkout lock must be
// released on the way out (both handled by the page's unmount cleanup).

export interface PricingWorkbookEntry {
	/** Route path, leading slash, single top-level segment. */
	path: string;
	/** Pricing Workbook `title` -- the selection + import key. */
	title: string;
	/** Sidebar label. */
	label: string;
}

export const PRICING_WORKBOOKS: readonly PricingWorkbookEntry[] = [
	{ path: "/hvac-pricing", title: "HVAC Pricing", label: "HVAC Pricing" },
	{ path: "/electrical-pricing", title: "Electrical Pricing", label: "Electrical Pricing" },
	{ path: "/elv-pricing", title: "ELV Pricing", label: "ELV Pricing" },
];

/**
 * Resolve the registry entry for a pathname. Matches the FIRST path segment, so
 * it is robust to trailing slashes and any future sub-path. Returns undefined
 * for an unregistered path -- the page renders a visible error state, never a
 * blank screen.
 */
export function workbookForPath(pathname: string): PricingWorkbookEntry | undefined {
	const first = `/${(pathname || "").split("/").filter(Boolean)[0] ?? ""}`;
	return PRICING_WORKBOOKS.find((w) => w.path === first);
}
