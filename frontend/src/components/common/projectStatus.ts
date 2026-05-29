// v3 dual-field model: a Projects record carries two orthogonal status fields.
//
//   tendering_status (Select) — the bid dimension. Tendering / Won / Lost.
//                               Set by the Create / Convert / Mark-as-Lost flows
//                               and NEVER through the manual status dropdown.
//
//   status (Data, free-form)  — the execution lifecycle. Only meaningful when
//                               tendering_status === "Won"; empty for pre-Won
//                               (Tendering or Lost) records.

// ---- Execution lifecycle (the `status` field) -----------------------------

export type ExecutionStatus =
  | "Created"
  | "WIP"
  | "Completed"
  | "Halted"
  | "Handover"
  | "CEO Hold";

export const EXECUTION_STATUS_OPTIONS: ExecutionStatus[] = [
  "Created",
  "WIP",
  "Completed",
  "Halted",
  "Handover",
  "CEO Hold",
];

// The manual status dropdown (Project Detail page) lets the user move a Won
// project along its execution lifecycle. CEO Hold is gated separately at the
// usage site to a single authorized user.
export const MANUAL_EXECUTION_STATUS_OPTIONS: ExecutionStatus[] = [
  "Created",
  "WIP",
  "Completed",
  "Halted",
  "Handover",
  "CEO Hold",
];

export const DEFAULT_PROJECT_STATUS_FILTER: ExecutionStatus[] = ["WIP", "Handover"];

// ---- Bid dimension (the `tendering_status` field) -------------------------

export type TenderingStatus = "Tendering" | "Won" | "Lost";

export const TENDERING_STATUS_OPTIONS: TenderingStatus[] = [
  "Tendering",
  "Won",
  "Lost",
];

// ---- Backwards-compatibility shims ----------------------------------------

/**
 * @deprecated Use `ExecutionStatus | TenderingStatus`. Kept so the rest of the
 * tree continues to compile during the v3 cutover; remove once all call sites
 * have moved to the explicit dimension types.
 */
export type ProjectStatus = ExecutionStatus | TenderingStatus;

/**
 * @deprecated Use `EXECUTION_STATUS_OPTIONS`. Same compatibility shim — the
 * historical "options" list mixed the bid + execution dimensions.
 */
export const PROJECT_STATUS_OPTIONS: ProjectStatus[] = [
  ...EXECUTION_STATUS_OPTIONS,
];

// ---- Helpers --------------------------------------------------------------

export const isTenderingStub = (tendering_status?: string | null): boolean =>
  tendering_status === "Tendering";

export const isLost = (tendering_status?: string | null): boolean =>
  tendering_status === "Lost";

export const isPreWon = (tendering_status?: string | null): boolean =>
  tendering_status !== "Won";

export const isOperational = (tendering_status?: string | null): boolean =>
  tendering_status === "Won";

// ---- Badge classes --------------------------------------------------------
//
// One flat map so a caller can resolve the badge class from either field's
// value with a single lookup (the option sets are disjoint after v3).

export const PROJECT_STATUS_BADGE_CLASSES: Record<string, string> = {
  // execution
  Created: "bg-purple-100 text-purple-800 border-purple-400",
  WIP: "bg-yellow-100 text-yellow-800 border-yellow-400",
  Completed: "bg-green-100 text-green-800 border-green-400",
  Halted: "bg-red-100 text-red-800 border-red-400",
  "CEO Hold": "bg-amber-100 text-amber-900 border-amber-500",
  Handover: "bg-blue-100 text-blue-800 border-blue-400",
  // tendering
  Tendering: "bg-slate-100 text-slate-700 border-slate-400",
  Won: "bg-indigo-100 text-indigo-800 border-indigo-400",
  Lost: "bg-rose-100 text-rose-800 border-rose-400",
};
