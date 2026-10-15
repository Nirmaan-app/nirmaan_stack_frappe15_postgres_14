/**
 * The Payee page's first tab (#1423, #1434, mockup screen 2): the bank account card and the "At a
 * glance" card. No lock and no "last paid": a Payee is an address book entry, edited in place.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PayeePage } from "@/types/NirmaanStack/Payee";
import { formatDate } from "@/utils/FormatDate";

const Field = ({ label, value, mono = false }: {
    label: string;
    value?: string | number | null;
    mono?: boolean;
}) => (
    <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-primary">{label}</p>
        <p className={`break-words text-sm font-medium ${mono ? "tabular-nums tracking-wide" : ""}`}>{value ?? "--"}</p>
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
                        <Field label="Account number" value={payee.account_number} mono />
                        <Field label="IFSC code" value={payee.ifsc} mono />
                        <Field label="Bank name" value={payee.bank_name} />
                        <Field label="Branch" value={payee.bank_branch} />
                        <Field label="Added" value={formatDate(payee.creation)} />
                    </div>
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
                    <Field
                        label="Holder name last changed"
                        value={payee.holder_name_changed_on ? formatDate(payee.holder_name_changed_on) : "Never"}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
