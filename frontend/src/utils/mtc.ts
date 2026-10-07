/**
 * Material Test Certificate (MTC) line rules -- the client copy of
 * `nirmaan_stack/services/mtc_rules.py`. The server is the enforcement boundary; this
 * decides what the screens offer. Keep the two in step.
 *
 * - An MTC can be uploaded, edited or deleted on a Billable PO in any status except
 *   Merged, Cancelled and Inactive (owner ruling Q39).
 * - An MTC covers Billable PO lines only. A line is identified by item + make.
 * - A line can be on at most one MTC of its PO.
 */
import type { MaterialTestCertificate, MTCItem } from "@/types/NirmaanStack/MaterialTestCertificate";

export const MTC_BLOCKED_STATUSES: readonly string[] = ["Merged", "Cancelled", "Inactive"];

export interface POLineInput {
  item_id?: string | null;
  item_name?: string | null;
  make?: string | null;
  category?: string | null;
  procurement_package?: string | null;
  billing_status?: string | null;
}

export interface MTCLine extends MTCItem {
  key: string;
}

/** Identity of a PO line: item + make, blanks normalised. */
export const mtcLineKey = (itemId?: string | null, make?: string | null): string =>
  `${(itemId ?? "").trim()}::${(make ?? "").trim()}`;

/** May MTCs on this PO be uploaded, edited or deleted right now? */
export const isPoOpenForMTC = (billingStatus?: string | null, status?: string | null): boolean =>
  billingStatus === "Billable" && !!status && !MTC_BLOCKED_STATUSES.includes(status);

const toLine = (row: POLineInput | MTCItem): MTCLine => ({
  key: mtcLineKey(row.item_id, row.make),
  item_id: (row.item_id ?? "").trim(),
  item_name: row.item_name ?? undefined,
  make: (row.make ?? "").trim() || undefined,
  category: row.category ?? undefined,
  procurement_package: row.procurement_package ?? undefined,
});

/** Billable lines of a PO, in PO order. The first row wins when a PO repeats a line. */
export const billableLines = (poItems: POLineInput[] | undefined | null): MTCLine[] => {
  const seen = new Set<string>();
  const out: MTCLine[] = [];
  for (const row of poItems ?? []) {
    if (row.billing_status !== "Billable" || !(row.item_id ?? "").trim()) continue;
    const line = toLine(row);
    if (seen.has(line.key)) continue;
    seen.add(line.key);
    out.push(line);
  }
  return out;
};

/** Lines already on an MTC of this PO -> that MTC's name. `excludeName` skips the MTC being edited. */
export const takenLineKeys = (
  mtcs: MaterialTestCertificate[] | undefined | null,
  excludeName?: string
): Map<string, string> => {
  const taken = new Map<string, string>();
  for (const mtc of mtcs ?? []) {
    if (mtc.name === excludeName) continue;
    for (const item of mtc.items ?? []) taken.set(mtcLineKey(item.item_id, item.make), mtc.name);
  }
  return taken;
};

/** Billable lines not yet on any MTC of the PO (other than `excludeName`). */
export const coverableLines = (
  poItems: POLineInput[] | undefined | null,
  mtcs: MaterialTestCertificate[] | undefined | null,
  excludeName?: string
): MTCLine[] => {
  const taken = takenLineKeys(mtcs, excludeName);
  return billableLines(poItems).filter((line) => !taken.has(line.key));
};

/**
 * Why a Certificate Date is not acceptable, or null. Mirrors `mtc_rules.certificate_date_problem`:
 * required, and never after today. Both arguments are "YYYY-MM-DD" strings, which compare as dates.
 */
export const certificateDateProblem = (date: string | null | undefined, today: string): string | null => {
  if (!date) return "Enter the Certificate Date printed on the certificate.";
  if (date > today) return "The Certificate Date can't be in the future.";
  return null;
};

/**
 * A certificate file's display name. Cloud-stored files carry it in the `file_name` query
 * parameter (`/api/method/...generate_file?key=...&file_name=x.pdf`); local ones in the path.
 */
export const mtcFileName = (url?: string | null): string => {
  if (!url) return "Attached file";
  const fromQuery = url.match(/[?&]file_name=([^&]+)/);
  const raw = fromQuery ? fromQuery[1] : url.split("?")[0].split("/").pop() || "";
  try {
    return decodeURIComponent(raw) || "Attached file";
  } catch {
    return raw || "Attached file";
  }
};

export type MTCItemTag = "gone" | "not-billable";

/**
 * Why an item saved on an MTC no longer matches the PO (owner ruling Q14: the MTC is kept and
 * the item tagged). `gone` = no longer on the PO; `not-billable` = on the PO but Non-Billable now.
 */
export const mtcItemTag = (item: MTCItem, poItems: POLineInput[] | undefined | null): MTCItemTag | null => {
  const key = mtcLineKey(item.item_id, item.make);
  const onPo = (poItems ?? []).filter((row) => mtcLineKey(row.item_id, row.make) === key);
  if (onPo.length === 0) return "gone";
  return onPo.some((row) => row.billing_status === "Billable") ? null : "not-billable";
};

export const MTC_ITEM_TAG_LABEL: Record<MTCItemTag, string> = {
  gone: "no longer on this PO",
  "not-billable": "no longer billable",
};

/**
 * The lines the Edit dialog offers: this MTC's own items first (ticked, tagged where they
 * no longer match the PO), then the billable lines no MTC has claimed.
 */
export const editableLines = (
  mtc: MaterialTestCertificate,
  poItems: POLineInput[] | undefined | null,
  mtcs: MaterialTestCertificate[] | undefined | null
): MTCLine[] => {
  const own = (mtc.items ?? []).map(toLine);
  const ownKeys = new Set(own.map((l) => l.key));
  const free = coverableLines(poItems, mtcs, mtc.name).filter((l) => !ownKeys.has(l.key));
  return [...own, ...free];
};
