/**
 * The Payee page's first tab (#1423, mockup screen 2): the bank account card, with the lock on the
 * account number and IFSC once the Payee is paid, and the "At a glance" card.
 */

import { Lock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PayeePage } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";

const Field = ({ label, value, locked = false, mono = false }: {
    label: string;
    value?: string | number | null;
    locked?: boolean;
    mono?: boolean;
}) => (
    <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-primary">{label}</p>
        <p className={`flex items-center gap-1.5 break-words text-sm font-medium ${mono ? "tabular-nums tracking-wide" : ""}`}>
            {value ?? "--"}
            {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-zinc-500" role="img" aria-label="Locked" />}
        </p>
    </div>
);

export function PayeeOverviewTab({ payee }: { payee: PayeePage }) {
    return (
        <div className="flex flex-wrap items-start gap-5">
            <Card className="min-w-0 flex-[3_1_560px]">
                <CardHeader>
                    <CardTitle className="text-lg text-primary">Bank account</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                        <Field label="Account holder name" value={payee.account_name} />
                        <Field label="Account number" value={payee.account_number} locked={payee.locked} mono />
                        <Field label="IFSC code" value={payee.ifsc} locked={payee.locked} mono />
                        <Field label="Bank name" value={payee.bank_name} />
                        <Field label="Branch" value={payee.bank_branch} />
                        <Field label="Added" value={formatDate(payee.creation)} />
                    </div>
                    {payee.locked && (
                        <p className="rounded-md bg-muted px-3 py-2.5 text-[13px] text-zinc-600">
                            The account number and IFSC are locked because money has been paid here. If this payee moves to
                            a new bank, add a new payee, point the vendors at it, and mark this one inactive.
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card className="min-w-0 flex-[2_1_320px]">
                <CardHeader>
                    <CardTitle className="text-lg text-primary">At a glance</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="mb-1 text-xs font-medium text-primary">Linked vendors</p>
                        <p className="text-[22px] font-bold">{payee.vendors}</p>
                    </div>
                    <div>
                        <p className="mb-1 text-xs font-medium text-primary">Linked expenses</p>
                        <p className="text-[22px] font-bold">{payee.expenses}</p>
                    </div>
                    <Field label="Last paid" value={payee.last_paid ? formatDate(payee.last_paid) : "Never"} />
                    <Field
                        label="Holder name last changed"
                        value={payee.holder_name_changed_on ? formatDate(payee.holder_name_changed_on) : "Never"}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
