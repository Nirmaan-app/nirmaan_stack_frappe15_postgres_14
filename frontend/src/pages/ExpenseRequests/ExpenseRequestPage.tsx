// src/pages/ExpenseRequests/ExpenseRequestPage.tsx
//
// One expense request's page, `/expense/requests/:requestId`, reached from its ID on the list.
//
// Built by #1502 for "Add invoice later": its header, its answers and the Invoice card. #1500 added
// the live status and amount in the header and "Where it stands" at the top of the main column,
// both from `standing` in the same server call (`read.get_expense_request`), read from the
// Expense on the server. This page never works out a status itself.

import React, { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { ArrowLeft, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import type { ExpenseRequestDetail } from "@/types/NirmaanStack/ExpenseRequest";
import type { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

import AddInvoiceDialog from "./components/AddInvoiceDialog";
import LiveStatusBadge from "./components/LiveStatusBadge";
import WhereItStands from "./components/WhereItStands";

// Answers are stored as ISO dates; the screen reads dd-MMM-yyyy.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const show = (v: string) => (ISO_DATE.test(v) ? formatDate(v) : v);

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {children}
    </section>
);

export const ExpenseRequestPage: React.FC = () => {
    const { requestId } = useParams<{ requestId: string }>();
    const [adding, setAdding] = useState(false);
    const { data, error, isLoading, mutate } = useFrappeGetCall<{ message: ExpenseRequestDetail }>(
        "nirmaan_stack.api.expense_requests.read.get_expense_request",
        { name: requestId },
        requestId ? `expense_request_page_${requestId}` : null
    );
    const req = data?.message;

    // Who acted on each step, by name.
    const { data: users } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", "full_name"], limit: 0,
    });
    const getUserName = useCallback(
        (id?: string) => users?.find((u) => u.name === id)?.full_name || id || "--",
        [users]
    );

    if (error) return <AlertDestructive error={error} />;
    if (isLoading || !req) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

    const invoice = req.invoice ?? {};
    const hasInvoice = !!invoice.invoice_attachment;
    const paid = req.status === "Paid" || req.expense?.status === "Paid";

    return (
        <div className="flex flex-col gap-5 p-4">
            <Link to="/expense/requests" className="flex w-fit items-center gap-1 text-sm text-primary hover:underline">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Expenses
            </Link>

            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-xl font-bold">{req.name} · {req.type}</h1>
                    <p className="text-sm text-muted-foreground">
                        {[req.projects_name || req.projects, `raised by ${req.owner_name} on ${formatDate(req.creation)}`]
                            .filter(Boolean).join(" · ")}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <span className="text-xl font-bold tabular-nums">
                            {formatToRoundedIndianRupee(req.standing.amount)}
                        </span>
                        {/* Accounts may have corrected the Expense's amount since it was raised. */}
                        {req.standing.amount !== Number(req.amount) && (
                            <div className="text-xs text-muted-foreground">
                                Raised for {formatToRoundedIndianRupee(Number(req.amount))}
                            </div>
                        )}
                    </div>
                    <LiveStatusBadge status={req.standing.status} />
                </div>
            </div>

            <div className="flex flex-wrap items-start gap-5">
                <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
                    <Card title="Where it stands">
                        <WhereItStands steps={req.standing.steps} getUserName={getUserName} />
                    </Card>
                    <Card title="Details">
                        {req.detail.length ? (
                            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                                {req.detail.map((d, i) => (
                                    <div key={i}>
                                        <dt className="text-xs text-muted-foreground">{d.label}</dt>
                                        <dd className="break-words text-sm">{show(String(d.value ?? ""))}</dd>
                                    </div>
                                ))}
                            </dl>
                        ) : (
                            <p className="text-sm text-muted-foreground">No details.</p>
                        )}
                        {req.comment && (
                            <p className="text-sm"><span className="text-muted-foreground">Comment: </span>{req.comment}</p>
                        )}
                    </Card>
                </div>

                <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-5">
                    <Card title="Invoice">
                        {hasInvoice ? (
                            <div className="flex flex-col gap-1 text-sm">
                                <a
                                    href={invoice.invoice_attachment}
                                    target="_blank" rel="noreferrer"
                                    className="flex items-center gap-2 text-primary hover:underline"
                                >
                                    <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{invoice.invoice_attachment!.split("/").pop()}</span>
                                </a>
                                <span>
                                    <span className="text-muted-foreground">Date: </span>
                                    {invoice.invoice_date ? formatDate(invoice.invoice_date) : "not given"}
                                </span>
                                <span>
                                    <span className="text-muted-foreground">Number: </span>
                                    {invoice.invoice_ref || "not given"}
                                </span>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {paid
                                    ? "No invoice was added before it was paid."
                                    : "No invoice yet. You can add it until the expense is paid."}
                            </p>
                        )}
                        {req.can_add_invoice && (
                            <>
                                <p className="text-xs text-muted-foreground">
                                    The file, date and number are copied to the expense too, so Accounts
                                    sees them when paying.
                                </p>
                                <Button variant="outline" onClick={() => setAdding(true)}>
                                    {hasInvoice ? "Replace invoice" : "Add invoice"}
                                </Button>
                            </>
                        )}
                    </Card>
                </aside>
            </div>

            <AddInvoiceDialog
                open={adding}
                onOpenChange={setAdding}
                requestName={req.name}
                amount={Number(req.amount)}
                current={invoice}
                onSaved={() => mutate()}
            />
        </div>
    );
};

export default ExpenseRequestPage;
