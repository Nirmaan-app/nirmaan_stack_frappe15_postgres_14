/** Colours shared by the Audit View tab cards and summary strip (each Against matches its table badge). */
import { AuditAgainst } from "../../utils/auditView";

/** Bar colour of each Against, matching its badge in the table. */
export const AGAINST_BAR: Record<AuditAgainst, string> = {
  PO: "bg-blue-600",
  WO: "bg-violet-600",
  "Project Expense": "bg-amber-500",
  "Non-Project Expense": "bg-slate-500",
};

/** Diagonal stripes for "not yet invoiced" (the part of a bar that is still open). */
export const STRIPES = {
  backgroundImage: "repeating-linear-gradient(-45deg, rgb(203 213 225) 0 4px, transparent 4px 7px)",
} as const;
