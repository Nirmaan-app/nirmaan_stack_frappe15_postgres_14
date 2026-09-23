// The pure half of the expense Approve / Reject dialog's details block (ADR-0010 F4) -- what
// `api/approvals/expense_detail.get_expense_approval_detail` returns, and the two decisions the
// block makes over it. No DOM test environment here, so anything decided inline in the component
// would be untestable.

import { attachmentsFromSourceData } from "@/utils/expenseFormat";
import { statusAfterL1, TIER_L2_ABOVE_EXPENSES } from "@/utils/approvalTiers";

export interface ExpenseApprovalDetail {
  doctype: "Project Expenses" | "Non Project Expenses";
  name: string;
  status: string;
  type: string;
  amount: number;
  project: string | null;
  project_name: string | null;
  vendor: string | null;
  vendor_name: string | null;
  description: string;
  comment: string;
  invoice_ref: string;
  invoice_date: string | null;
  invoice_attachment: string;
  payment_by: string;
  /** The REQUEST's owner when there is one -- never the reviewer who inserted the row. */
  raised_by: string | null;
  raised_on: string | null;
  request: {
    name: string;
    creation: string;
    reviewed_by: string | null;
    reviewed_on: string | null;
    source_data: string | null;
    detail: { label: string; value: string }[];
  } | null;
  similar: { doctype: string; name: string; amount: number; status: string; on: string }[];
  user_names: Record<string, string>;
}

export type ApprovalStage = "lead" | "ceo";

/** Where THIS click lands the expense. The CEO's always finishes it; L1's forwards above the line. */
export const expenseApprovalOutcome = (
  stage: ApprovalStage,
  amount: number | string | null | undefined
): { finishes: boolean; text: string } => {
  if (stage === "ceo" || statusAfterL1(amount, TIER_L2_ABOVE_EXPENSES) === "Approved") {
    return { finishes: true, text: "Your approval finishes this: it moves to Approved, ready to be paid." };
  }
  return {
    finishes: false,
    text: `Above ₹${TIER_L2_ABOVE_EXPENSES.toLocaleString("en-IN")}, so your approval forwards it to the CEO.`,
  };
};

/** The request's files, minus the bill already shown on the row's own Invoice line. */
export const requestAttachments = (detail: ExpenseApprovalDetail | null | undefined): string[] => {
  if (!detail?.request) return [];
  const seen = new Set(detail.invoice_attachment ? [detail.invoice_attachment] : []);
  const out: string[] = [];
  for (const url of attachmentsFromSourceData(detail.request.source_data)) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
};

/**
 * Whether the row's own Description line is worth showing. A request-born row's description IS
 * the request's answers joined into one line (`convert.compose_description`), so beside the
 * labelled list it only repeats them.
 */
export const showsDescription = (detail: ExpenseApprovalDetail | null | undefined): boolean =>
  !!detail?.description && !(detail.request?.detail?.length);
