// What an approver is deciding on, for a Project / Non-Project EXPENSE row (owner, 2026-09-21).
//
// The queue row carries only what a table column needs, so the Approve / Reject dialog used to
// show an amount and nothing else. This reads the rest from
// `api/approvals/expense_detail.get_expense_approval_detail`, fetched only while the dialog is open.

import React from "react";
import { useFrappeGetCall } from "frappe-react-sdk";
import { AlertTriangle, ArrowRight, CheckCircle2, Paperclip } from "lucide-react";
import { TailSpin } from "react-loader-spinner";

import SITEURL from "@/constants/siteURL";
import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee from "@/utils/FormatPrice";
import {
  ApprovalStage,
  ExpenseApprovalDetail,
  expenseApprovalOutcome,
  requestAttachments,
  showsDescription,
} from "../expenseApprovalDetail";

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[7.5rem_1fr] gap-x-3 py-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="min-w-0 break-words">{children}</span>
  </div>
);

const FileLink: React.FC<{ url: string; label: string }> = ({ url, label }) => (
  <a
    href={url.startsWith("http") ? url : SITEURL + url}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-1 text-primary hover:underline"
  >
    <Paperclip className="h-3.5 w-3.5" /> {label}
  </a>
);

interface Props {
  doctype: string;
  name: string;
  isOpen: boolean;
  /** Which approval this dialog performs -- decides the outcome line. */
  stage: ApprovalStage;
  /** The outcome line is an approve-only claim. */
  approving: boolean;
}

export const ExpenseApprovalDetails: React.FC<Props> = ({ doctype, name, isOpen, stage, approving }) => {
  const { data, error, isLoading } = useFrappeGetCall<{ message: ExpenseApprovalDetail }>(
    "nirmaan_stack.api.approvals.expense_detail.get_expense_approval_detail",
    { doctype, name },
    isOpen && name ? `expense_approval_detail_${doctype}_${name}` : null
  );
  const d = data?.message;

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <TailSpin width={24} height={24} color="red" />
      </div>
    );
  }
  if (error || !d) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load this expense's details. You can still {approving ? "approve" : "reject"} it.
      </p>
    );
  }

  const nameOf = (u?: string | null) => (u && d.user_names[u]) || u || "--";
  const extraFiles = requestAttachments(d);
  const outcome = expenseApprovalOutcome(stage, d.amount);
  const invoiceBits = [d.invoice_ref, d.invoice_date ? formatDate(d.invoice_date) : ""].filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 px-3 py-2 divide-y">
        <div className="flex items-baseline justify-between gap-2 pb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {d.doctype === "Project Expenses" ? "Project Expense" : "Non-Project Expense"}
          </span>
          <span className="text-xs text-muted-foreground">{d.name}</span>
        </div>
        <Row label="Type">{d.type || "--"}</Row>
        <Row label="Amount">
          <span className="font-semibold tabular-nums">{formatToIndianRupee(d.amount)}</span>
        </Row>
        <Row label="Project">
          {d.project ? (
            <>
              {d.project_name || d.project}
              {d.project_name && (
                <span className="block text-xs text-muted-foreground">{d.project}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">-- non-project --</span>
          )}
        </Row>
        {d.vendor && <Row label="Vendor">{d.vendor_name || d.vendor}</Row>}
        <Row label="Raised by">
          {nameOf(d.raised_by)}
          {d.raised_on ? ` · ${formatDate(d.raised_on)}` : ""}
        </Row>
        {d.payment_by && <Row label="Payment by">{d.payment_by}</Row>}
        {showsDescription(d) && (
          <Row label="Description">
            <span className="whitespace-pre-wrap">{d.description}</span>
          </Row>
        )}
        {d.comment && <Row label="Comment">{d.comment}</Row>}
        {(invoiceBits.length > 0 || d.invoice_attachment) && (
          <Row label="Invoice">
            <span className="flex flex-wrap items-center gap-x-2">
              {invoiceBits.length > 0 && <span>{invoiceBits.join(" · ")}</span>}
              {d.invoice_attachment && <FileLink url={d.invoice_attachment} label="View invoice" />}
            </span>
          </Row>
        )}
      </div>

      {d.request && (
        <div className="rounded-md border px-3 py-2 divide-y">
          <div className="pb-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Request {d.request.name}
            </p>
            {d.request.reviewed_by && (
              <p className="text-xs text-muted-foreground">
                Request approved by {nameOf(d.request.reviewed_by)}
                {d.request.reviewed_on ? ` on ${formatDate(d.request.reviewed_on)}` : ""}
              </p>
            )}
          </div>
          {d.request.detail.map((row, i) => (
            <Row key={i} label={row.label || "--"}>
              <span className="whitespace-pre-wrap">{row.value}</span>
            </Row>
          ))}
          {extraFiles.length > 0 && (
            <div className="flex flex-wrap gap-3 py-1.5 text-sm">
              {extraFiles.map((url, i) => (
                <FileLink key={url} url={url} label={extraFiles.length > 1 ? `Attachment ${i + 1}` : "View attachment"} />
              ))}
            </div>
          )}
        </div>
      )}

      {d.similar.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {d.similar.length} other expense{d.similar.length > 1 ? "s" : ""} of this type and amount in the last 60 days
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
            {d.similar.slice(0, 5).map((s) => (
              <li key={`${s.doctype}:${s.name}`}>
                {s.name} · {s.status} · {formatDate(s.on)}
              </li>
            ))}
            {d.similar.length > 5 && <li>and {d.similar.length - 5} more</li>}
          </ul>
        </div>
      )}

      {approving && (
        <p
          className={`flex items-start gap-1.5 text-sm ${
            outcome.finishes ? "text-emerald-700 dark:text-emerald-400" : "text-sky-700 dark:text-sky-400"
          }`}
        >
          {outcome.finishes ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {outcome.text}
        </p>
      )}
    </div>
  );
};
