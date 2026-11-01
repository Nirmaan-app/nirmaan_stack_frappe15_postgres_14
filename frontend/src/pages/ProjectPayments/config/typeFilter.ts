/**
 * The Type filter of the Payments queue (owner, 2026-10-31): one flat list, one checkbox per row.
 *
 * Its values are what the server matches on (`get_approval_queue._type_clause`): a row's stored
 * `source_type`, or a narrower option "<source_type>:<detail>" — a WO payment of the GST only, a PO
 * payment by cheque, a PO payment on a Credit Payment Cheque (also a cheque one), an expense of one expense
 * type. The labels are what the list reads.
 *
 * ORDER: the four types and Non Project – Reimbursement first, then WO Payment – GST, PO Payment – Cheque,
 * PO Payment – Credit Cheque, every Project Expense type, every Non Project type (each set most used first,
 * as the server counts them).
 *
 * A type and its own narrower options may be ticked together (owner, 2026-10-31): each box ticks only
 * itself. The rows are the same as the type alone, since the type already lists them all.
 */

export const TYPE_DETAIL_SEP = ":";

/** The fixed top of the list, in order. "Reimbursement" is the Non Project – Reimbursement option. */
const TYPE_TOP = ["SR Payment", "PO Payment", "Project Expense", "Non-Project", "Reimbursement"] as const;
const DETAIL_TOP = ["SR Payment:GST", "PO Payment:Cheque", "PO Payment:Credit Cheque"] as const;
/** The types whose narrower options are expense types, in the order their sets follow. */
const EXPENSE_TYPES = ["Project Expense", "Non-Project"] as const;

const TYPE_FILTER_LABEL: Record<string, string> = {
  "SR Payment": "WO Payment",
  "PO Payment": "PO Payment",
  "Project Expense": "Project Expense",
  "Non-Project": "Non Project Expense",
  "Reimbursement": "Non Project – Reimbursement",
  "Vendor Payment": "Payment",
  "SR Payment:GST": "WO Payment – GST",
  "PO Payment:Cheque": "PO Payment – Cheque",
  "PO Payment:Credit Cheque": "PO Payment – Credit Cheque",
};

/** What a narrower option's label starts with. */
const DETAIL_PREFIX: Record<string, string> = {
  "Project Expense": "Project Expense",
  "Non-Project": "Non Project",
};

/** The type a value belongs to, and whether it is a narrower option of it. */
const typeGroupOf = (value: string): { group: string; narrower: boolean } => {
  if (value === "Reimbursement") return { group: "Non-Project", narrower: true };
  const i = value.indexOf(TYPE_DETAIL_SEP);
  return i < 0 ? { group: value, narrower: false } : { group: value.slice(0, i), narrower: true };
};

export const typeFilterLabel = (value: string): string => {
  if (TYPE_FILTER_LABEL[value]) return TYPE_FILTER_LABEL[value];
  const i = value.indexOf(TYPE_DETAIL_SEP);
  if (i < 0) return value;
  const group = value.slice(0, i);
  return `${DETAIL_PREFIX[group] ?? TYPE_FILTER_LABEL[group] ?? group} – ${value.slice(i + 1)}`;
};

/**
 * Where a value sits in the list: the fixed top first, then each expense-type set. Values of one set keep
 * the order they arrive in (the server sends them most used first). A value nothing names goes last.
 */
const rankOf = (value: string): number => {
  const top = (TYPE_TOP as readonly string[]).indexOf(value);
  if (top >= 0) return top;
  const detail = (DETAIL_TOP as readonly string[]).indexOf(value);
  if (detail >= 0) return TYPE_TOP.length + detail;
  const { group, narrower } = typeGroupOf(value);
  const set = (EXPENSE_TYPES as readonly string[]).indexOf(group);
  if (narrower && set >= 0) return TYPE_TOP.length + DETAIL_TOP.length + set;
  return TYPE_TOP.length + DETAIL_TOP.length + EXPENSE_TYPES.length;
};

/** The options in list order. Stable, so each expense-type set keeps the server's most-used-first order. */
export const orderTypeOptions = <T extends { value: string }>(options: T[]): T[] =>
  options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rankOf(a.o.value) - rankOf(b.o.value) || a.i - b.i)
    .map(({ o }) => o);
