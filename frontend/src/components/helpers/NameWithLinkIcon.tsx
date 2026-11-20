import { Info } from "lucide-react";
import { Link } from "react-router-dom";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface NameWithLinkIconProps {
  /** The text the cell shows, e.g. the project or vendor name. */
  label: string;
  /** Where the icon goes; no icon when absent. */
  to?: string;
  /** Hover text on the icon, e.g. "View Project". */
  hint: string;
}

/**
 * A table cell's name followed by a small blue info icon that links to the record, the
 * way the PO Invoices table shows its Project and Vendor columns.
 */
export const NameWithLinkIcon = ({ label, to, hint }: NameWithLinkIconProps) => (
  <div className="font-medium flex items-center gap-1 min-w-0">
    <span className="truncate" title={label}>{label}</span>
    {to && (
      <HoverCard>
        <HoverCardTrigger asChild>
          <Link to={to} aria-label={hint}>
            <Info className="w-4 h-4 text-blue-600 cursor-pointer flex-shrink-0" />
          </Link>
        </HoverCardTrigger>
        <HoverCardContent className="text-xs w-auto p-1.5">{hint}</HoverCardContent>
      </HoverCard>
    )}
  </div>
);
