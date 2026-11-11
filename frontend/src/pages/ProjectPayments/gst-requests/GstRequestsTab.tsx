import { useEffect, useMemo, useRef, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { Check, MessageSquare, X } from "lucide-react";
import { Link } from "react-router-dom";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { facetMeta } from "@/components/data-table/facetConfig";
import { DataTable, SearchFieldOption } from "@/components/data-table/new-data-table";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getUrlStringParam, useServerDataTable } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";
import type { GSTPaymentRequestRow, GstRequestStatus } from "@/types/NirmaanStack/GSTPaymentRequest";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import { GST_REQUEST_CHIP } from "@/utils/gstPaymentRequests";
import { urlStateManager } from "@/utils/urlStateManager";

import { GstDecisionDialog } from "./GstDecisionDialog";
import { GstRequestDeleteButton } from "./GstRequestDeleteButton";

const DOCTYPE = "GST Payment Request";
const URL_KEY = "gst_requests";
const STATUS_PARAM = "gst_status";

/** A request as the table reads it: the doctype's own fields. */
type GstRequestDoc = Pick<GSTPaymentRequestRow,
	"name" | "work_order" | "project" | "vendor" | "amount" | "status" | "owner" | "creation" | "review_comment" | "project_payment">;

const FETCH_FIELDS = ["name", "work_order", "project", "vendor", "amount", "status", "owner", "creation", "review_comment", "project_payment"];

const SEARCHABLE_FIELDS: SearchFieldOption[] = [
	{ value: "work_order", label: "Work Order", placeholder: "Search by Work Order", default: true },
	{ value: "name", label: "Request ID", placeholder: "Search by request ID" },
];

/** The status pills above the table: the waiting ones first, as they are the work; "All" for every request. */
const STATUS_PILLS: { label: string; status: GstRequestStatus | "All" }[] = [
	{ label: "Pending", status: "Pending" },
	{ label: "Approved", status: "Approved" },
	{ label: "Paid", status: "Paid" },
	{ label: "Rejected", status: "Rejected" },
	{ label: "All", status: "All" },
];
const isPill = (v: string): v is GstRequestStatus | "All" => STATUS_PILLS.some((p) => p.status === v);

interface GstRequestsTabProps {
	/** May the viewer approve and reject? Everyone else sees the rows only. */
	canDecide: boolean;
	/** Refetch the page's tab badges after a decision. */
	onDecided?: () => void;
}

type Decision = { name: string; kind: "approve" | "reject" };

/** The records behind the ids on screen (names, GSTIN), keyed by id; read once per page of rows. */
const useLookup = (doctype: string, fields: string[], ids: string[]) => {
	const unique = useMemo(() => [...new Set(ids.filter(Boolean))].sort(), [ids]);
	const { data } = useFrappeGetDocList<Record<string, string>>(
		doctype, { fields: ["name", ...fields], filters: [["name", "in", unique]], limit: unique.length || 1 },
		unique.length ? `gst-requests-lookup:${doctype}:${unique.join(",")}` : null,
	);
	return useMemo(() => Object.fromEntries((data ?? []).map((r) => [r.name, r])), [data]);
};

/**
 * "GST Requests" on Payments & Expenses: every Work Order GST Payment Request (`services/gst_payment_requests`),
 * in the app's data table, filterable by Project, Vendor and Work Order. Approving a Pending one creates the
 * payment, routed by amount as any payment is; rejecting creates nothing and frees the GST it held.
 */
export default function GstRequestsTab({ canDecide, onDecided }: GstRequestsTabProps) {
	const [status, setStatus] = useState<GstRequestStatus | "All">(() => {
		const fromUrl = getUrlStringParam(STATUS_PARAM, "Pending");
		return isPill(fromUrl) ? fromUrl : "Pending";
	});
	const statusFilter = useMemo(() => (status === "All" ? [] : [["status", "=", status]]), [status]);
	const [decision, setDecision] = useState<Decision | null>(null);
	const [rowsForNames, setRowsForNames] = useState<GstRequestDoc[]>([]);

	const projectRows = useLookup("Projects", ["project_name"], useMemo(() => rowsForNames.map((r) => r.project), [rowsForNames]));
	const vendorRows = useLookup("Vendors", ["vendor_name", "vendor_gst"], useMemo(() => rowsForNames.map((r) => r.vendor), [rowsForNames]));
	const userRows = useLookup("Nirmaan Users", ["full_name"], useMemo(() => rowsForNames.map((r) => r.owner), [rowsForNames]));
	const projects = useMemo(() => Object.fromEntries(Object.entries(projectRows).map(([k, v]) => [k, v.project_name])), [projectRows]);
	const vendors = useMemo(() => Object.fromEntries(Object.entries(vendorRows).map(([k, v]) => [k, v.vendor_name])), [vendorRows]);
	const gstins = useMemo(() => Object.fromEntries(Object.entries(vendorRows).map(([k, v]) => [k, (v.vendor_gst || "").trim()])), [vendorRows]);
	const users = useMemo(() => Object.fromEntries(Object.entries(userRows).map(([k, v]) => [k, v.full_name])), [userRows]);

	const start = (name: string, kind: Decision["kind"]) => setDecision({ name, kind });
	// The table's live `refetch`, read when a row is deleted: the columns are built before the table that owns
	// it, and are not rebuilt when only the filter or page changes.
	const refetchRef = useRef<() => void>(() => {});

	// The data table stretches every column by its share of any spare width, so no one column is sized much
	// larger than the others: a wide screen then spreads the spare evenly instead of leaving one big gap.
	const columns = useMemo<ColumnDef<GstRequestDoc>[]>(() => [
		{
			accessorKey: "work_order",
			header: ({ column }) => <DataTableColumnHeader column={column} title="Work Order" />,
			cell: ({ row }) => (
				<Link className="break-all font-medium text-blue-600 hover:underline" to={`/service-requests/${row.original.work_order}?tab=approved-sr`}>
					{row.original.work_order}
				</Link>
			),
			size: 145,
			enableColumnFilter: true,
			meta: { ...facetMeta({ field: "work_order", title: "Work Order" }), exportHeaderName: "Work Order", exportValue: (r: GstRequestDoc) => r.work_order },
		},
		{
			accessorKey: "project",
			header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
			cell: ({ row }) => <span className="break-words">{projects[row.original.project] || row.original.project}</span>,
			size: 130,
			enableColumnFilter: true,
			meta: { ...facetMeta({ field: "project", title: "Project" }), exportHeaderName: "Project", exportValue: (r: GstRequestDoc) => projects[r.project] || r.project },
		},
		{
			accessorKey: "vendor",
			header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
			cell: ({ row }) => (
				<div className="min-w-0">
					<span className="block break-words">{vendors[row.original.vendor] || row.original.vendor}</span>
					<span className="block break-all font-mono text-[11px] text-muted-foreground">{gstins[row.original.vendor] || "No GSTIN"}</span>
				</div>
			),
			size: 190,
			enableColumnFilter: true,
			meta: { ...facetMeta({ field: "vendor", title: "Vendor" }), exportHeaderName: "Vendor", exportValue: (r: GstRequestDoc) => vendors[r.vendor] || r.vendor },
		},
		{
			accessorKey: "amount",
			header: ({ column }) => <DataTableColumnHeader column={column} title="GST Amount" />,
			cell: ({ row }) => <span className="font-semibold tabular-nums">{formatToIndianRupee(row.original.amount)}</span>,
			size: 120,
			meta: { exportHeaderName: "GST Amount", exportValue: (r: GstRequestDoc) => r.amount },
		},
		{
			accessorKey: "owner",
			header: ({ column }) => <DataTableColumnHeader column={column} title="Raised By" />,
			cell: ({ row }) => <span className="break-words">{users[row.original.owner] || row.original.owner}</span>,
			size: 125,
			enableColumnFilter: true,
			meta: { ...facetMeta({ field: "owner", title: "Raised By" }), exportHeaderName: "Raised By", exportValue: (r: GstRequestDoc) => users[r.owner] || r.owner },
		},
		{
			accessorKey: "creation",
			header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
			cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.creation)}</span>,
			size: 120,
			meta: { exportHeaderName: "Created", exportValue: (r: GstRequestDoc) => formatDate(r.creation) },
		},
		{
			accessorKey: "status",
			header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
			cell: ({ row }) => (
				<div className="min-w-0">
					{/* The short word here: the pill above already says which status is listed. */}
					<div className="flex items-center gap-1.5">
						<span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium", GST_REQUEST_CHIP[row.original.status].className)}>
							{row.original.status}
						</span>
						{/* A rejection's reason sits behind an icon, as on TDS History, so a long one never stretches the row. */}
						{row.original.status === "Rejected" && row.original.review_comment && (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<button type="button" className="cursor-help text-red-500 hover:text-red-700 dark:text-red-400"
											aria-label={`Rejection reason: ${row.original.review_comment}`}>
											<MessageSquare className="h-3.5 w-3.5" />
										</button>
									</TooltipTrigger>
									<TooltipContent className="max-w-xs whitespace-normal break-words">
										<p>{row.original.review_comment}</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
					</div>
					{row.original.project_payment && <span className="block break-all font-mono text-[11px] text-muted-foreground">{row.original.project_payment}</span>}
				</div>
			),
			size: 100,
			meta: { exportHeaderName: "Status", exportValue: (r: GstRequestDoc) => r.status },
		},
		...(canDecide ? [{
			id: "actions",
			header: () => <span>Actions</span>,
			cell: ({ row }: { row: { original: GstRequestDoc } }) => (
				<div className="flex items-center gap-0.5">
					{row.original.status === "Pending" && <>
						<Button size="icon" variant="ghost" className="h-6 w-6 text-green-700 hover:bg-green-50 hover:text-green-800 dark:text-green-400"
							title="Approve" aria-label={`Approve ${row.original.name}`}
							onClick={() => start(row.original.name, "approve")}>
							<Check className="h-4 w-4" />
						</Button>
						<Button size="icon" variant="ghost" className="h-6 w-6 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400"
							title="Reject" aria-label={`Reject ${row.original.name}`}
							onClick={() => start(row.original.name, "reject")}>
							<X className="h-4 w-4" />
						</Button>
					</>}
					{/* Pending and Rejected only; an Approved or Paid one goes with its payment. */}
					<GstRequestDeleteButton row={row.original} onDeleted={() => { refetchRef.current(); onDecided?.(); }} />
				</div>
			),
			size: 84,
			enableSorting: false,
		} as ColumnDef<GstRequestDoc>] : []),
	// eslint-disable-next-line react-hooks/exhaustive-deps
	], [canDecide, projects, vendors, gstins, users, onDecided]);

	const {
		table, data, totalCount, isLoading, error, refetch,
		searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField, exportAllRows, isExporting,
	} = useServerDataTable<GstRequestDoc>({
		doctype: DOCTYPE,
		columns,
		fetchFields: FETCH_FIELDS,
		searchableFields: SEARCHABLE_FIELDS,
		defaultSort: "creation desc",
		urlSyncKey: URL_KEY,
		additionalFilters: statusFilter,
		enableRowSelection: false,
		getRowId: (row) => row.name,
	});

	refetchRef.current = refetch;

	// The names are read for the rows on screen only: the columns need them, and the rows come from the columns' table.
	const dataKey = data.map((r) => r.name).join(",");
	useEffect(() => { setRowsForNames(data); }, [dataKey]); // eslint-disable-line react-hooks/exhaustive-deps

	// The dialog holds the request's name; the row is read from the live page.
	const open = useMemo(() => data.find((r) => r.name === decision?.name) ?? null, [data, decision]);

	// No pill change while rows are loading: useServerDataTable drops a fetch asked for while one is running
	// and never retries it, so a pill clicked then would light up over the previous status's rows.
	const chooseStatus = (next: GstRequestStatus | "All") => {
		if (next === status || isLoading) return;
		setStatus(next);
		urlStateManager.updateParam(STATUS_PARAM, next);
		table.setPageIndex(0);
	};

	if (error) return <AlertDestructive error={error} />;

	return (
		<div className="flex flex-col gap-2">
			<DataTable<GstRequestDoc>
				table={table}
				columns={columns}
				facetDoctype={DOCTYPE}
				isLoading={isLoading}
				error={error}
				totalCount={totalCount}
				searchFieldOptions={SEARCHABLE_FIELDS}
				selectedSearchField={selectedSearchField}
				onSelectedSearchFieldChange={setSelectedSearchField}
				searchTerm={searchTerm}
				onSearchTermChange={setSearchTerm}
				showExportButton
				onExport="default"
				onExportAll={exportAllRows}
				isExporting={isExporting}
				exportFileName="GST_Requests"
				summaryCard={
					<div className="flex flex-col gap-3">
						<p className="max-w-[72ch] text-sm text-muted-foreground">
							GST payments on Work Orders wait here for an Accountant. Approving creates the payment, which then
							follows the usual approval by amount. Rejecting creates nothing.
						</p>
						<div className="flex flex-wrap gap-2" role="tablist" aria-label="GST requests by status">
							{STATUS_PILLS.map((pill) => (
								<button key={pill.status} type="button" role="tab" aria-selected={status === pill.status}
									disabled={isLoading}
									onClick={() => chooseStatus(pill.status)}
									className={cn(
										"whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60",
										status === pill.status ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
									)}>
									{pill.label}
								</button>
							))}
						</div>
					</div>
				}
			/>

			<GstDecisionDialog
				kind={decision?.kind ?? "approve"}
				target={open ? {
					name: open.name, workOrder: open.work_order, amount: open.amount, creation: open.creation,
					projectName: projects[open.project] || open.project,
					vendorName: vendors[open.vendor] || open.vendor,
					raisedByName: users[open.owner] || open.owner,
				} : null}
				onClose={() => setDecision(null)}
				onDone={() => { setDecision(null); refetch(); onDecided?.(); }}
			/>
		</div>
	);
}
