import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  DataTable,
  SearchFieldOption,
} from "@/components/data-table/new-data-table";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { ColumnDef, Table } from "@tanstack/react-table";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import SITEURL from "@/constants/siteURL";
import { Badge } from "@/components/ui/badge";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { TruncatedText } from "@/components/common/TruncatedText";
import { ChequeChip } from "@/components/cheques/ChequeChip";
import { useChequeChips } from "@/components/cheques/useChequeChips";
import { showsChequeChip } from "@/utils/cheques/chequeChip";
import { PAYMENT_STATUS } from "@/constants/paymentStatus";
import { cn } from "@/lib/utils";
import { orderPageHref } from "@/pages/ProjectPayments/components/poRoute";
import {
  chequeIssuedOn,
  chequeWaitingText,
  type PaymentListFilter,
  VENDOR_PAYMENT_GROUP,
  type VendorPaymentGroup,
} from "@/utils/vendorPayments/paymentGroups";

interface VendorPaymentsTableProps {
  vendorId: string;
  projectOptions: Array<{ label: string; value: string }>;
  /** The sub-tab this table lists (`VendorPaymentsTabs`). */
  group: VendorPaymentGroup;
  /** The sub-tab's list filters, vendor first (`vendorPaymentGroupFilters`). */
  filters: PaymentListFilter[];
}

const PAYMENT_TABLE_FIELDS: (keyof ProjectPayments | "name")[] = [
  "name",
  "utr",
  "payment_attachment",
  "mode_of_payment",
  "cheque",
  "cheque_no",
  "document_name",
  "document_type",
  "project",
  "payment_date",
  "approval_date",
  "ceo_approval_date",
  "creation",
  "amount",
  "status",
];

const PAYMENT_ID_SEARCH: SearchFieldOption = { value: "name", label: "Payment ID" };
const REF_DOC_SEARCH: SearchFieldOption = { value: "document_name", label: "Ref. Doc ID" };
const UTR_SEARCH: SearchFieldOption = { value: "utr", label: "UTR/Ref No." };
const CHEQUE_NO_SEARCH: SearchFieldOption = { value: "cheque_no", label: "Cheque No." };

/** Each sub-tab searches what its rows are known by first: a UTR, a cheque number, a Payment ID. */
const SEARCH_FIELDS: Record<VendorPaymentGroup, SearchFieldOption[]> = {
  [VENDOR_PAYMENT_GROUP.PAID]: [{ ...UTR_SEARCH, default: true }, CHEQUE_NO_SEARCH, PAYMENT_ID_SEARCH, REF_DOC_SEARCH],
  [VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED]: [{ ...CHEQUE_NO_SEARCH, default: true }, PAYMENT_ID_SEARCH, REF_DOC_SEARCH],
  [VENDOR_PAYMENT_GROUP.OTHERS]: [{ ...PAYMENT_ID_SEARCH, default: true }, REF_DOC_SEARCH, CHEQUE_NO_SEARCH],
};

/** Paid and Other statuses list the newest first; Cheque Issued lists the cheque waiting longest first. */
const DEFAULT_SORT: Record<VendorPaymentGroup, string> = {
  [VENDOR_PAYMENT_GROUP.PAID]: "payment_date desc",
  [VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED]: "approval_date asc",
  [VENDOR_PAYMENT_GROUP.OTHERS]: "creation desc",
};

const DATE_FILTER_COLUMNS: Record<VendorPaymentGroup, string[]> = {
  [VENDOR_PAYMENT_GROUP.PAID]: ["payment_date"],
  [VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED]: [],
  [VENDOR_PAYMENT_GROUP.OTHERS]: ["creation"],
};

const STATUS_BADGE: Record<string, string> = {
  [PAYMENT_STATUS.REQUESTED]: "border-gray-300 bg-gray-100 text-gray-800",
  [PAYMENT_STATUS.CEO_PENDING]: "border-violet-300 bg-violet-50 text-violet-900",
  [PAYMENT_STATUS.APPROVED]: "border-blue-300 bg-blue-50 text-blue-900",
  [PAYMENT_STATUS.RECONCILIATION_PENDING]: "border-orange-300 bg-orange-50 text-orange-900",
  [PAYMENT_STATUS.REJECTED]: "border-red-200 bg-red-50 text-red-800",
};

/**
 * The cheque chip (spec #1407) for a cheque payment, else `fallback`. Every chip on the page asks for the whole
 * page's Cheques under one key, so the page makes one call, not one per row.
 */
const PaymentChequeOr = ({
  payment,
  table,
  fallback,
}: {
  payment: ProjectPayments;
  table: Table<ProjectPayments>;
  fallback: React.ReactNode;
}) => {
  const chips = useChequeChips(table.getRowModel().rows.map((r) => r.original.cheque));
  const chip = payment.cheque ? chips[payment.cheque] : undefined;
  if (!showsChequeChip({ ...payment, cheque_status: chip?.status })) return <>{fallback}</>;
  return <ChequeChip cheque={payment.cheque} chequeNo={chip?.cheque_no || payment.cheque_no || ""} status={chip?.status} />;
};

/** The Payment ID in small grey text, under a row's UTR or cheque. */
const PaymentIdLine = ({ name }: { name: string }) => (
  <span className="block text-[11px] font-normal text-muted-foreground">{name}</span>
);

export const VendorPaymentsTable: React.FC<VendorPaymentsTableProps> = ({
  vendorId,
  projectOptions,
  group,
  filters,
}) => {
  const columns = useMemo<ColumnDef<ProjectPayments>[]>(() => {
    const referenceDoc: ColumnDef<ProjectPayments> = {
      accessorKey: "document_name",
      header: "Reference Doc",
      cell: ({ row }) => {
        const { document_name, document_type } = row.original;
        const href = orderPageHref(document_name, document_type);
        return (
          <div className="font-medium min-w-[170px]">
            {href ? (
              <Link to={href} className="text-blue-600 hover:underline">
                {document_name}
              </Link>
            ) : (
              document_name
            )}
            <span className="text-xs text-muted-foreground">
              {" "}({document_type === "Procurement Orders" ? "PO" : "WO"})
            </span>
          </div>
        );
      },
      meta: {
        exportValue: (row: ProjectPayments) =>
          `${row.document_name ?? ""} (${row.document_type === "Procurement Orders" ? "PO" : "WO"})`,
      },
      size: 200,
    };
    const projectLabel = (id?: string) => projectOptions.find((p) => p.value === id)?.label || id || "";
    const project: ColumnDef<ProjectPayments> = {
      accessorKey: "project",
      header: "Project",
      cell: ({ row }) => <div className="truncate max-w-[150px]">{projectLabel(row.original.project)}</div>,
      size: 180,
      meta: {
        facet: { field: "project", title: "Project", decoupled: true } satisfies FacetDeclaration,
        exportValue: (row: ProjectPayments) => projectLabel(row.project),
      },
    };
    const amount = (header: string): ColumnDef<ProjectPayments> => ({
      accessorKey: "amount",
      header,
      cell: ({ row }) => <div className="font-medium">{formatToRoundedIndianRupee(row.original.amount)}</div>,
      meta: { isNumeric: true },
      size: 130,
    });

    if (group === VENDOR_PAYMENT_GROUP.PAID) {
      return [
        {
          accessorKey: "utr",
          header: "UTR / Cheque",
          cell: ({ row, table }) => {
            const payment = row.original;
            return (
              <div className="font-medium min-w-[150px] space-y-0.5">
                {payment.cheque_no ? (
                  <PaymentChequeOr
                    payment={payment}
                    table={table}
                    fallback={<TruncatedText text={payment.utr} fallback="N/A" />}
                  />
                ) : (
                  <TruncatedText text={payment.utr} fallback="N/A" />
                )}
                <PaymentIdLine name={payment.name} />
              </div>
            );
          },
          meta: {
            exportHeaderName: "UTR / Cheque",
            exportValue: (row: ProjectPayments) =>
              row.cheque_no ? `Cheque ${row.cheque_no}${row.utr ? ` / ${row.utr}` : ""}` : row.utr || "",
          },
          size: 180,
        },
        referenceDoc,
        project,
        {
          accessorKey: "payment_date",
          header: "Paid On",
          cell: ({ row }) => (
            <div className="whitespace-nowrap">{formatDate(row.original.payment_date || row.original.creation)}</div>
          ),
          meta: { exportValue: (row: ProjectPayments) => formatDate(row.payment_date || row.creation) },
          size: 140,
        },
        amount("Amount Paid"),
        {
          accessorKey: "payment_attachment",
          header: "Receipt",
          enableSorting: false,
          cell: ({ row }) => {
            const { payment_attachment } = row.original;
            if (!payment_attachment) return <span className="text-sm text-muted-foreground">--</span>;
            return (
              <a
                href={`${SITEURL}${payment_attachment}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-green-700 hover:underline"
              >
                Attached
              </a>
            );
          },
          meta: { excludeFromExport: true },
          size: 130,
        },
      ];
    }

    if (group === VENDOR_PAYMENT_GROUP.CHEQUE_ISSUED) {
      return [
        {
          accessorKey: "cheque_no",
          header: "Cheque",
          cell: ({ row, table }) => (
            <div className="min-w-[160px] space-y-0.5">
              <PaymentChequeOr
                payment={row.original}
                table={table}
                fallback={<span className="font-medium">Cheque {row.original.cheque_no}</span>}
              />
              <PaymentIdLine name={row.original.name} />
            </div>
          ),
          meta: { exportValue: (row: ProjectPayments) => `Cheque ${row.cheque_no ?? ""}` },
          size: 190,
        },
        {
          accessorKey: "approval_date",
          header: "Issued On",
          cell: ({ row }) => {
            const issuedOn = chequeIssuedOn(row.original);
            return <div className="whitespace-nowrap">{issuedOn ? formatDate(issuedOn) : "--"}</div>;
          },
          meta: {
            exportValue: (row: ProjectPayments) => {
              const issuedOn = chequeIssuedOn(row);
              return issuedOn ? formatDate(issuedOn) : "";
            },
          },
          size: 130,
        },
        referenceDoc,
        project,
        amount("Amount"),
        {
          id: "waiting",
          header: "Waiting",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="whitespace-nowrap text-sm">
              {chequeWaitingText(chequeIssuedOn(row.original), new Date()) || "--"}
            </div>
          ),
          meta: { exportValue: (row: ProjectPayments) => chequeWaitingText(chequeIssuedOn(row), new Date()) },
          size: 170,
        },
      ];
    }

    return [
      {
        accessorKey: "name",
        header: "Payment ID",
        cell: ({ row }) => <div className="font-medium whitespace-nowrap">{row.original.name}</div>,
        size: 150,
      },
      referenceDoc,
      project,
      {
        accessorKey: "creation",
        header: "Requested On",
        cell: ({ row }) => <div className="whitespace-nowrap">{formatDate(row.original.creation)}</div>,
        size: 140,
      },
      amount("Amount"),
      {
        accessorKey: "mode_of_payment",
        header: "Mode",
        cell: ({ row, table }) => {
          const payment = row.original;
          if (!payment.cheque_no) return <span className="text-sm">Online</span>;
          return (
            <PaymentChequeOr
              payment={payment}
              table={table}
              fallback={<span className="text-sm">Cheque {payment.cheque_no}</span>}
            />
          );
        },
        meta: { exportValue: (row: ProjectPayments) => (row.cheque_no ? `Cheque ${row.cheque_no}` : "Online") },
        size: 170,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline" className={cn("whitespace-nowrap font-medium", STATUS_BADGE[row.original.status])}>
            {row.original.status}
          </Badge>
        ),
        size: 170,
      },
    ];
  }, [group, projectOptions]);

  const searchableFields = SEARCH_FIELDS[group];

  const {
    table,
    isLoading,
    error,
    totalCount,
    exportAllRows,
    isExporting,
    searchTerm,
    setSearchTerm,
    selectedSearchField,
    setSelectedSearchField,
  } = useServerDataTable<ProjectPayments>({
    doctype: "Project Payments",
    columns: columns,
    fetchFields: PAYMENT_TABLE_FIELDS as string[],
    searchableFields,
    urlSyncKey: `vendor_payments_${group}_${vendorId}`,
    additionalFilters: filters,
    defaultSort: DEFAULT_SORT[group],
  });

  if (error) return <AlertDestructive error={error} />;

  return (
    <DataTable<ProjectPayments>
        table={table}
        columns={columns}
        isLoading={isLoading}
        totalCount={totalCount}
        searchFieldOptions={searchableFields}
        selectedSearchField={selectedSearchField}
        onSelectedSearchFieldChange={setSelectedSearchField}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        showExportButton={true}
        onExport="default"
        onExportAll={exportAllRows}
        isExporting={isExporting}
        facetDoctype="Project Payments"
        facetOverrides={{ project: { additionalFilters: filters } }}
        dateFilterColumns={DATE_FILTER_COLUMNS[group]}
        exportFileName={`vendor_payments_${group}_${vendorId}`}
      />
  );
};

export default VendorPaymentsTable;
