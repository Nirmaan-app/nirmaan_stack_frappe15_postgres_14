import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { Projects } from "@/types/NirmaanStack/Projects"; // Base Project type
import { parseNumber } from "@/utils/parseNumber";
import { Link } from "react-router-dom";
import formatToIndianRupee from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCalculatedFields } from "../../hooks/useProjectReportCalculations";
import { Info } from "lucide-react";
import {
  CASHFLOW_GAP_POINTS,
  CURRENT_LIABILITIES_POINTS,
  INFLOW_POINTS,
  NOTIONAL_GST_POINTS,
  PROJECT_OUTFLOW_POINTS,
  TOTAL_CREDIT_PURCHASE_POINTS,
  type TooltipPoint,
} from "@/constants/projectOutflow";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { urlStateManager } from "@/utils/urlStateManager";
import { projectReportLink, type ProjectReportLink } from "../../utils/projectReportLink";

/**
 * A Cash Sheet figure that opens a project's report. A plain click sets the report's filters and the report
 * through `urlStateManager`, which the Reports page subscribes to, so it switches at once (walk W8); a
 * modified click (new tab) follows the href.
 */
const ProjectReportAnchor: React.FC<{ link: ProjectReportLink; children: React.ReactNode }> = ({ link, children }) => (
  <Link
    to={link.url}
    className="text-blue-600 hover:underline"
    onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      urlStateManager.updateParam(link.filterKey, link.filters);
      urlStateManager.updateParam("report", link.report);
    }}
  >
    {children}
  </Link>
);

/** A column's ⓘ points as a bullet list; a point with sub-points nests them under it. */
const TooltipPoints: React.FC<{ points: readonly TooltipPoint[] }> = ({ points }) => (
  <ul className="list-disc space-y-0.5 pl-4">
    {points.map((point, i) =>
      typeof point === "string" ? (
        <li key={i}>{point}</li>
      ) : (
        <li key={i}>
          {point.text}
          <ul className="mt-0.5 space-y-0.5 pl-3">
            {point.points.map((sub, j) => (
              <li key={j}>{sub}</li>
            ))}
          </ul>
        </li>
      ),
    )}
  </ul>
);

// Wraps a column header with a small info icon that reveals a definition tooltip on hover: a sentence, or
// points shown as a bullet list. The icon is a sibling of the sort trigger so clicks don't toggle sort.
export const HeaderWithInfo: React.FC<{
  tooltip: string | readonly TooltipPoint[];
  children: React.ReactNode;
}> = ({ tooltip, children }) => (
  // `min-w-0` lets the title shrink and the icon (`shrink-0`, above the next header) stay inside the
  // column, so its tooltip opens (walk W6: at 1920px it spilled under "Current Liability").
  <div className="flex min-w-0 items-center gap-1">
    <div className="min-w-0">{children}</div>
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Column definition"
          className="relative z-10 shrink-0 text-muted-foreground hover:text-foreground focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-snug">
        {typeof tooltip === "string" ? tooltip : <TooltipPoints points={tooltip} />}
      </TooltipContent>
    </Tooltip>
  </div>
);



// Helper functions (formatValueToLakhsString, formatDisplayValueToLakhs) remain the same...


export const formatValueToLakhsString = (value: string | number | undefined | null): string => {
  const num = parseNumber(value);
  if (isNaN(num)) return "-";
  if (num === 0) return "0.00 L";
  const valueInLakhs = (num / 100000).toFixed(2);
  return `${valueInLakhs} L`;
};

/** Returns just the numeric lakhs value as a string (e.g., "2.50") for CSV exports */
export const formatValueToLakhsNumber = (value: string | number | undefined | null): string => {
  const num = parseNumber(value);
  if (isNaN(num)) return "";
  if (num === 0) return "0.00";
  return (num / 100000).toFixed(2);
};

const formatDisplayValueToLakhs = (value: string | number | undefined | null): string => {
  const num = parseNumber(value);
  if (isNaN(num)) return "-";
  if (num === 0) return "₹0 L";
  const valueInLakhs = num / 100000;
  return formatToIndianRupee(valueInLakhs) + " L";
};


// Define the expected structure of table.options.meta
interface ProjectTableMeta {
  getProjectCalculatedFields: (projectId: string) => ProjectCalculatedFields | null;
  isLoadingGlobalDeps: boolean;
  dateRange?: { from?: string; to?: string };
}

// A generic cell renderer for calculated fields
const CalculatedCell: React.FC<{
  row: Row<Projects>;
  table: Table<Projects>;
  accessor: keyof ProjectCalculatedFields | 'totalCredit'; // Which field to access from calculatedData
  formatter: (value: number | undefined) => string;
  isLink?: boolean;
  projectId?: string;
  linkToReport?: 'Inflow Report' | 'Outflow Report(Project)';
}> = ({ row, table, accessor, formatter, isLink = false, projectId, linkToReport }) => {
  const meta = table.options.meta as ProjectTableMeta | undefined;

  if (!meta || typeof meta.getProjectCalculatedFields !== 'function') {
    console.error("Table meta not configured correctly for calculated fields.");
    return <span className="text-destructive text-xs">Meta Error</span>;
  }

  if (meta.isLoadingGlobalDeps) {
    return <Skeleton className="h-4 w-20 my-1" />;
  }

  const calculatedData = meta.getProjectCalculatedFields(row.original.name);

  if (calculatedData === null) { // Data is still being processed or not available
    return <Skeleton className="h-4 w-20 my-1" />;
  }

  let valueToFormat: number | undefined;
  if (accessor === 'totalCredit') {
    valueToFormat = parseNumber(calculatedData.totalInvoiced) - parseNumber(calculatedData.totalInflow);
  } else {
    valueToFormat = calculatedData[accessor];
  }

  const displayValue = <div className="tabular-nums">{formatter(valueToFormat)}</div>;

  if (isLink && projectId && linkToReport) {
    return (
      <ProjectReportAnchor link={projectReportLink(linkToReport, projectId, meta.dateRange)}>
        {displayValue}
      </ProjectReportAnchor>
    );
  }

  return displayValue;
};




export type ProjectWithCalculations = Projects & Partial<ProjectCalculatedFields> & {
    cashflowGap?: number;
};

// projectColumns is now a function that returns the column definitions.
// This allows for more flexibility if columns needed to be truly dynamic based on props,
// though for this case, accessing meta via `table` in cell renderers is the key.
export const getClientProjectColumns = (): ColumnDef<ProjectWithCalculations>[] => [
  {
    accessorKey: "project_name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
    cell: ({ row }) => (
      <Link to={`/projects/${row.original.name}`} className="text-blue-600 hover:underline">
        {row.original.project_name || row.original.name}
      </Link>
    ),
    size: 150, // Adjust size as needed
    meta: { exportHeaderName: "Project Name", exportValue: (row: Projects) => row.project_name || row.name }
  },
   {
    accessorKey: "project_value_gst",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Value (incl. GST)" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ row }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(row.original.project_value_gst)}</div>,
    size:120,
    meta: { exportHeaderName: "Value incl. GST (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.project_value_gst), isNumeric: true }
  },
  {
    accessorKey: "totalProjectInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Client Invoiced (incl. GST)" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 150,
    
    meta: { exportHeaderName: "Client Invoiced incl. GST (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.totalProjectInvoiced), isNumeric: true }
  },
  {
    accessorKey: "totalInflow",
    header: ({ column }) => (
      <HeaderWithInfo tooltip={INFLOW_POINTS}>
        <DataTableColumnHeader column={column} title="Inflow" />
      </HeaderWithInfo>
    ),
    cell: ({ row, getValue, table }) => {
        const value = getValue() as number;
        
        // Link logic copied and adapted for direct value access
        const meta = table.options.meta as ProjectTableMeta | undefined; // Using any to bypass strictly defined old meta type for now
        const { dateRange } = meta || {};

        if (row.original.name) {
             return (
                <ProjectReportAnchor link={projectReportLink("Inflow Report", row.original.name, dateRange)}>
                     <div className="tabular-nums">{formatDisplayValueToLakhs(value)}</div>
                </ProjectReportAnchor>
             )
        }
        return <div className="tabular-nums">{formatDisplayValueToLakhs(value)}</div>
    },
    size: 100,
    meta: { exportHeaderName: "Inflow (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.totalInflow), isNumeric: true }
  },
  {
    accessorKey: "totalOutflow",
    header: ({ column }) => (
      <HeaderWithInfo tooltip={PROJECT_OUTFLOW_POINTS}>
        <DataTableColumnHeader column={column} title="Project Outflow" />
      </HeaderWithInfo>
    ),
    cell: ({ row, getValue, table }) => {
        const value = getValue() as number;
         // Link logic adapted
        const meta = table.options.meta as ProjectTableMeta | undefined; 
        const { dateRange } = meta || {};

        if (row.original.name) {
             return (
                <ProjectReportAnchor link={projectReportLink("Outflow Report(Project)", row.original.name, dateRange)}>
                     <div className="tabular-nums">{formatDisplayValueToLakhs(value)}</div>
                </ProjectReportAnchor>
             )
        }
        return <div className="tabular-nums ">{formatDisplayValueToLakhs(value)}</div>
    },
    size: 140,
    meta: { exportHeaderName: "Project Outflow (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.totalOutflow), isNumeric: true }
  },
  {
    accessorKey: "totalLiabilities",
    header: ({ column }) => (
      <HeaderWithInfo tooltip={CURRENT_LIABILITIES_POINTS}>
        <DataTableColumnHeader column={column} title="Current Liability" />
      </HeaderWithInfo>
    ),
    cell: ({ getValue }) => <div className="tabular-nums">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 150,
    meta: { exportHeaderName: "Current Liability (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.totalLiabilities), isNumeric: true }
  },
  {
    accessorKey: "cashflowGap",
    header: ({ column }) => (
      <HeaderWithInfo tooltip={CASHFLOW_GAP_POINTS}>
        <DataTableColumnHeader column={column} title="Cashflow Gap" />
      </HeaderWithInfo>
    ),
    cell: ({ getValue }) => {
        const val = getValue() as number;
        return (
            <div className={`tabular-nums ${val > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {formatDisplayValueToLakhs(val)}
            </div>
          );
    },
     size: 120,
    meta: { exportHeaderName: "Cashflow Gap (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.cashflowGap), isNumeric: true }
  },
  {
    accessorKey: "totalInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO+SR Value (incl. GST)" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 140,
    meta: { exportHeaderName: "Total PO+SR Value incl. GST (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.totalInvoiced), isNumeric: true }
  },
  {
    accessorKey: "notionalGst",
    header: ({ column }) => (
      <HeaderWithInfo tooltip={NOTIONAL_GST_POINTS}>
        <DataTableColumnHeader column={column} title="Notional GST" />
      </HeaderWithInfo>
    ),
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 120,
    meta: { exportHeaderName: "Notional GST (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.notionalGst), isNumeric: true }
  },
  {
    accessorKey: "totalPoSrInvoiced",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total PO+SR Invoice Received" className="[&_button]:whitespace-normal text-left" />,
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatDisplayValueToLakhs(getValue() as number)}</div>,
    size: 140,
    meta: { exportHeaderName: "Total PO+SR Invoice Received (in Lakhs)", exportValue: (row: any) => formatValueToLakhsNumber(row.totalPoSrInvoiced), isNumeric: true }
  },
  
  {
    accessorKey: "TotalPurchaseOverCredit",
    header: ({ column }) => (
      <HeaderWithInfo tooltip={TOTAL_CREDIT_PURCHASE_POINTS}>
        <DataTableColumnHeader column={column} title="Total Purchase Over Credit" className="[&_button]:whitespace-normal text-left" />
      </HeaderWithInfo>
    ),
    cell: ({ getValue }) => <div className="tabular-nums text-center">{formatValueToLakhsString(getValue() as number)}</div>,
    size: 140,
    meta: {
      exportHeaderName: "Total Purchase Over Credit (in Lakhs)",
      exportValue: (row: any) => formatValueToLakhsNumber(row.TotalPurchaseOverCredit),
      isNumeric: true
    }
  },
  // {
  //   id: "CreditPaidAmount", // A unique ID for the column
  //   header: ({ column }) => <DataTableColumnHeader column={column} title="Total Credit Amount Paid" />,
  //   // Pass the correct accessor string
  //   cell: (props) => <CalculatedCell {...props} accessor="CreditPaidAmount" formatter={formatValueToLakhsString} />,
  //   meta: {
  //     exportHeaderName: "Amount Due (Lakhs)",
  //     isNumeric: true
  //   }
  // },
  // --- END OF FIX ---

  // {
  //   accessorKey: "creation",
  //   header: ({ column }) => <DataTableColumnHeader column={column} title="Creation Date" />,
  //   cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
  //   meta: { exportHeaderName: "Creation Date", exportValue: (row: Projects) => formatDate(row.creation) }
  // },

];

// Alias for backward compatibility. Defined at the end to ensure getClientProjectColumns is initialized.
export const getProjectColumns = getClientProjectColumns;