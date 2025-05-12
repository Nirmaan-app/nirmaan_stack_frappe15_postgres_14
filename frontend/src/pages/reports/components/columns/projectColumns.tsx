import { ColumnDef } from "@tanstack/react-table";
import { ProcessedProject } from "../../hooks/useProjectReportsData"; // Adjust path
import { parseNumber } from "@/utils/parseNumber"; // Adjust path
import { Link } from "react-router-dom"; // Or your router's Link component
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";

// Helper function FOR EXPORTING LAKHS (returns string like "1.23 L")
// We don't include the Rupee symbol here for cleaner CSV data, but you can add it if needed.
const formatValueToLakhsString = (value: string | number | undefined | null): string => {
  const num = parseNumber(value);
  if (isNaN(num)) return "-"; // Or "" for empty cell
  if (num === 0) return "0.00 L"; // Explicit zero with lakhs suffix

  const valueInLakhs = (num / 100000).toFixed(2); // Keep 2 decimal places
  return `${valueInLakhs} L`;
};

// Helper function FOR DISPLAYING LAKHS (returns string like "₹1.23 L")
const formatDisplayValueToLakhs = (value: string | number | undefined | null): string => {
  const num = parseNumber(value);
  if (isNaN(num)) return "-";
  if (num === 0) return "₹0 L";

  const valueInLakhs = num / 100000;
  return formatToIndianRupee(valueInLakhs) + " L";
};


export const projectColumns: ColumnDef<ProcessedProject>[] = [
  {
    accessorKey: "project_name",
    header: "Project Name",
    cell: ({ row }) => {
      const name = row.original.project_name;
      const id = row.original.name;
      // Optional: Link to project details page
      return <Link to={`/projects/${id}`} className="text-blue-600 hover:underline">{name || id}</Link>;
    },
    // Enable sorting/filtering if needed using tanstack table features
  },

  {
    accessorKey: "creation",
    header: "Project Creation Date",
    cell: ({ row }) => {
      const date = row.original.creation;
      return <div>{formatDate(date)}</div>;
    },
    meta: {
      exportValue: (row: ProcessedProject) => formatDate(row.creation),
    }
  },
  {
    accessorKey: "project_value",
    header: "Value (excl. GST)",
    cell: ({ row }) => {
      // Access the original project_value field
      return <div className="tabular-nums">{formatDisplayValueToLakhs(row.original.project_value)}</div>;
    },
    meta: {
      // Use export formatter for CSV
      exportValue: (row: ProcessedProject) => formatValueToLakhsString(row.project_value),
      //  align: 'right'
    }
  },
  {
    // Use accessorKey pointing to the calculated field
    accessorKey: "totalInvoiced",
    header: "Total PO + SR Amount (incl. GST)",
    cell: ({ row }) => {
      // Access the calculated totalInvoiced field
      const totalInvoiced = row.original.totalInvoiced;
      return <div className="tabular-nums">{formatDisplayValueToLakhs(totalInvoiced)}</div>;
    },
    meta: {
      // Use export formatter for CSV
      exportValue: (row: ProcessedProject) => formatValueToLakhsString(row.totalInvoiced),
      //  align: 'right'
    }
  },
  {
    accessorKey: "totalInflow",
    header: "Inflow",
    cell: ({ row }) => {
      // Access the calculated totalInflow field
      const totalInflow = row.original.totalInflow;
      return <div className="tabular-nums">{formatDisplayValueToLakhs(totalInflow)}</div>;
    },
    meta: {
      // Use export formatter for CSV
      exportValue: (row: ProcessedProject) => formatValueToLakhsString(row.totalInflow),
      //  align: 'right'
    }
  },
  {
    accessorKey: "totalOutflow",
    header: "Outflow",
    cell: ({ row }) => {
      // Access the calculated totalOutflow field (sum of 'Paid' payments)
      const totalOutflow = row.original.totalOutflow;
      return <div className="tabular-nums">{formatDisplayValueToLakhs(totalOutflow)}</div>;
    },
    meta: {
      // Use export formatter for CSV
      exportValue: (row: ProcessedProject) => formatValueToLakhsString(row.totalOutflow),
      //  align: 'right'
    }
  },
  {
    accessorKey: "totalCredit",
    header: "Credit Outstanding",
    cell: ({ row }) => {
      // Access the calculated totalInflow field
      // const totalInflow = row.original.totalInflow;
      // return <div className="tabular-nums">{formatDisplayValueToLakhs(totalInflow)}</div>;
      return <div>placeholder</div>
    },
    // meta: {
    //   // Use export formatter for CSV
    //  exportValue: (row: ProcessedProject) => formatValueToLakhsString(row.totalInflow),
    // //  align: 'right'
    // }
  },
];