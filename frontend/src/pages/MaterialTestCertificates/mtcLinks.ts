import { encodeFrappeId } from "@/pages/DeliveryNotes/constants";
import type { MaterialTestCertificate } from "@/types/NirmaanStack/MaterialTestCertificate";

/** Short PO label used across the DC/MIR screens: PO/006/00061/25-26 -> PO-006. */
export const shortPOName = (po: string) => `PO-${po.split("/")[1] ?? po}`;

/** The PM-side route to a PO, through its PR. Null when the PR is unknown. */
export const poLinkFor = (mtc: MaterialTestCertificate): string | null =>
  mtc.procurement_request
    ? `/prs&milestones/procurement-requests/${mtc.procurement_request}/${encodeFrappeId(mtc.procurement_order)}`
    : null;
