/**
 * Click-to-open detail popovers for the Payments & Expenses tables.
 *
 * The AFFORDANCE is the cell itself: the whole cell is the trigger, and its text
 * carries a dotted underline. There is no "i" icon — an icon beside a truncated
 * name competes for the few pixels the name already lacks, and on a 205px Vendor
 * column that costs a readable name on every row.
 *
 * ⚠️ THE FETCH IS LAZY AND MUST STAY LAZY. These render one trigger PER ROW; a
 * fetch on mount would be 50 document reads per page of the queue, for popovers
 * nobody opened. `useFrappeGetDoc`'s THIRD argument is the swrKey (not options):
 * `null` = do not fetch, `undefined` = fetch with the default key. That is the
 * on/off switch here, and SWR caches the result, so re-opening the same row — or
 * opening another row with the same vendor — costs nothing.
 *
 * ⚠️ A LABEL ALREADY RESOLVED BY THE TABLE IS PASSED IN, never re-fetched. The
 * approval queue already carries id -> name maps for vendors and projects; the
 * popover shows that name instantly, before the document arrives, so the header
 * of the card never flashes an id.
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useFrappeGetDoc } from "frappe-react-sdk";
import { ExternalLink } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { poLinkFor, routeName } from "./poRoute";

/**
 * The one trigger style. Dotted underline = "there is more behind this", which is
 * deliberately NOT the solid underline the app uses for a NAVIGATION link: a click
 * here opens a card, it does not leave the page.
 */
export const DETAIL_TRIGGER_CLASS =
  "block w-full cursor-pointer text-left underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm";

const Field = ({ label, value }: { label: string; value?: React.ReactNode }) => {
  // A blank field is dropped, never rendered as "—": these cards are read at a
  // glance and an empty row is noise that pushes the filled ones down.
  if (value === null || value === undefined || value === "") return null;
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-words">{value}</span>
    </>
  );
};

const CardShell = ({
  title,
  subtitle,
  loading,
  children,
  to,
  linkLabel,
}: {
  title: string;
  subtitle?: string;
  loading: boolean;
  children: React.ReactNode;
  to: string;
  linkLabel: string;
}) => (
  <div className="space-y-2 text-xs">
    <div>
      <p className="font-semibold leading-tight break-all">{title}</p>
      {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
    </div>
    {loading ? (
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    ) : (
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t pt-2">{children}</div>
    )}
    <Link
      to={to}
      className="inline-flex items-center gap-1 border-t pt-2 text-primary hover:underline"
    >
      {linkLabel}
      <ExternalLink className="h-3 w-3" />
    </Link>
  </div>
);

/* ------------------------------------------------------------------ PO / WO */

interface DocumentDetailPopoverProps {
  /** The PO / SR document name. */
  docName: string;
  /** "Procurement Orders" (PO) or "Service Requests" (WO). */
  docType: string;
  vendorLabel?: string;
  /** The project id — the PO link routes under it (`/projects/:id/po/:po`). */
  projectId?: string;
  projectLabel?: string;
  children: React.ReactNode;
}

export const DocumentDetailPopover: React.FC<DocumentDetailPopoverProps> = ({
  docName,
  docType,
  vendorLabel,
  projectId,
  projectLabel,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const isPO = docType === "Procurement Orders";
  const doctype = isPO ? "Procurement Orders" : "Service Requests";
  const { data, isLoading } = useFrappeGetDoc<any>(
    doctype,
    docName,
    open ? undefined : null,
  );

  const total = Number(data?.total_amount ?? 0);
  const paid = Number(data?.amount_paid ?? 0);

  // The PO opens on the list tab its status belongs to (owner, 2026-09-21); see `poLinkFor`.
  const poLink = poLinkFor(docName, data?.status, projectId || data?.project);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={DETAIL_TRIGGER_CLASS}>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <CardShell
          title={docName}
          subtitle={isPO ? "Purchase Order" : "Work Order"}
          loading={isLoading}
          to={isPO ? poLink : `/service-requests-list/${routeName(docName)}`}
          linkLabel={isPO ? "Open PO" : "Open WO"}
        >
          <Field label="Vendor" value={data?.vendor_name || vendorLabel || data?.vendor} />
          <Field label="Project" value={data?.project_name || projectLabel || data?.project} />
          <Field label="Status" value={data?.status} />
          <Field label="Created" value={data?.creation ? formatDate(data.creation) : ""} />
          <Field label={isPO ? "PO Value" : "WO Value"} value={formatToRoundedIndianRupee(total)} />
          <Field label="Total Paid" value={formatToRoundedIndianRupee(paid)} />
          {/* Balance is DERIVED here rather than read from `amount_due`, which is a
              stored field on both doctypes and can sit stale behind a revision. */}
          <Field label="Balance" value={formatToRoundedIndianRupee(total - paid)} />
          {/* Delivered value only means something for a PO — a WO has no delivery. */}
          {isPO && (
            <Field
              label="Delivered"
              value={formatToRoundedIndianRupee(Number(data?.po_amount_delivered ?? 0))}
            />
          )}
        </CardShell>
      </PopoverContent>
    </Popover>
  );
};

/* ------------------------------------------------------------------- Vendor */

interface VendorDetailPopoverProps {
  vendorId: string;
  vendorLabel?: string;
  children: React.ReactNode;
}

export const VendorDetailPopover: React.FC<VendorDetailPopoverProps> = ({
  vendorId,
  vendorLabel,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useFrappeGetDoc<any>(
    "Vendors",
    vendorId,
    open ? undefined : null,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={DETAIL_TRIGGER_CLASS}>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <CardShell
          title={data?.vendor_name || vendorLabel || vendorId}
          subtitle="Vendor"
          loading={isLoading}
          to={`/vendors/${vendorId}`}
          linkLabel="Open vendor"
        >
          <Field label="GST" value={data?.vendor_gst} />
          <Field label="Contact" value={data?.vendor_contact_person_name} />
          <Field label="Phone" value={data?.vendor_mobile} />
          {/* Bank details, owner 2026-09-16 — these replaced email / city / status.
              This card is read while APPROVING a payment, and the question at that
              moment is "where is this money going", not "where is this vendor". */}
          <Field label="A/c No" value={data?.account_number} />
          <Field label="IFSC" value={data?.ifsc} />
          <Field label="Bank" value={data?.bank_name} />
        </CardShell>
      </PopoverContent>
    </Popover>
  );
};

/* ------------------------------------------------------------------ Project */

interface ProjectDetailPopoverProps {
  projectId: string;
  projectLabel?: string;
  children: React.ReactNode;
}

export const ProjectDetailPopover: React.FC<ProjectDetailPopoverProps> = ({
  projectId,
  projectLabel,
  children,
}) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useFrappeGetDoc<any>(
    "Projects",
    projectId,
    open ? undefined : null,
  );
  // `customer` is an id (CUST-0001); the readable company name lives on the
  // Customers doc, so it is a second lazy read — chained off the project, so it
  // never fires for a project that has no customer.
  const { data: customer } = useFrappeGetDoc<any>(
    "Customers",
    data?.customer,
    open && data?.customer ? undefined : null,
  );

  const place = [data?.project_city, data?.project_state].filter(Boolean).join(", ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={DETAIL_TRIGGER_CLASS}>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <CardShell
          title={data?.project_name || projectLabel || projectId}
          subtitle="Project"
          loading={isLoading}
          to={`/projects/${projectId}`}
          linkLabel="Open project"
        >
          <Field label="Code" value={projectId} />
          <Field label="Customer" value={customer?.company_name || data?.customer} />
          <Field label="Status" value={data?.status} />
          <Field label="Location" value={place} />
          <Field label="Start" value={data?.project_start_date ? formatDate(data.project_start_date) : ""} />
          <Field label="End" value={data?.project_end_date ? formatDate(data.project_end_date) : ""} />
        </CardShell>
      </PopoverContent>
    </Popover>
  );
};
