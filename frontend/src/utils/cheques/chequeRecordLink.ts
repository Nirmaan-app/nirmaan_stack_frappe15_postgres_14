/**
 * Where a cheque line's PO / WO links to: the order's own page.
 *
 * - A PO's name holds "/", which its route carries as "&=" (`/purchase-orders/:id`).
 * - A WO page with no `?tab=` opens Select Service Vendor (`RenderSRComponent`), so a WO link names
 *   `approved-sr`, which opens the Work Order itself (Finalized ones too).
 *
 * Null for any other record (or none), so the caller shows plain text. Router paths: hand them to `<Link to>`.
 */

const PO_DOCTYPE = "Procurement Orders";
const WO_DOCTYPE = "Service Requests";

const encodeName = (name: string) => name.replace(/\//g, "&=");

export const recordPagePath = (
    doctype: string | null | undefined,
    name: string | null | undefined
): string | null => {
    if (!name) return null;
    if (doctype === PO_DOCTYPE) return `/purchase-orders/${encodeName(name)}`;
    if (doctype === WO_DOCTYPE) return `/service-requests/${encodeName(name)}?tab=approved-sr`;
    return null;
};
