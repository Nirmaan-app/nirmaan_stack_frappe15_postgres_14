/**
 * `/payees/:payeeId` (#1423, spec #1420, approved mockup screen 2): one Payee.
 *
 * Its holder name and ID, then two tabs: Payee Overview (the bank account card and "At a glance")
 * and Linked Vendors, with its count on the label. A Payee is an address book entry (#1434): no
 * status, no lock, and no payments or expenses listed, since none points at it. Edit (#1435) changes
 * its holder name, account number and IFSC in place (`EditPayeeDialog`, naming every vendor it changes
 * when it serves several); Delete removes one no vendor links to (`DeletePayeeDialog`).
 *
 * Everything shown comes from `api/payees/payee_page.get_payee`, which reads the Payee module
 * (`services/payees/links.payee_page`). Accountant, Accountant Lead and Admin only: the route guard
 * reads `PAYEE_MANAGE_PROFILES`, and the server enforces it on every endpoint.
 */

import { useState } from "react";
import { PencilLine, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { EDIT_PAYEE_API, EditPayeeDialog } from "@/components/payees/EditPayeeDialog";
import { CHECK_PAYEE_API } from "@/components/payees/usePayeeBankForm";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { OverviewSkeleton2 } from "@/components/ui/skeleton";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";
import {
    PAYEE_PAGE_TAB_PARAM,
    PAYEE_PAGE_TABS,
    isPayeePageTab,
    payeePageTabs,
    type PayeePageTab,
} from "@/utils/payees/payeePage";
import { urlStateManager } from "@/utils/urlStateManager";

import { DeletePayeeDialog } from "./components/DeletePayeeDialog";
import { PayeeLinkedVendorsTab } from "./components/PayeeLinkedVendorsTab";
import { PayeeOverviewTab } from "./components/PayeeOverviewTab";
import { usePayeePage } from "./hooks/usePayeePage";

function PayeeView({ payeeId }: { payeeId: string }) {
    const { payee, error, isLoading, mutate } = usePayeePage(payeeId);
    const [tab, setTab] = useState<PayeePageTab>(() => {
        const fromUrl = getUrlStringParam(PAYEE_PAGE_TAB_PARAM, PAYEE_PAGE_TABS.OVERVIEW);
        return isPayeePageTab(fromUrl) ? fromUrl : PAYEE_PAGE_TABS.OVERVIEW;
    });
    const [editing, setEditing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const navigate = useNavigate();

    const chooseTab = (next: PayeePageTab) => {
        setTab(next);
        urlStateManager.updateParam(PAYEE_PAGE_TAB_PARAM, next);
    };

    if (isLoading) return <div className="p-6"><OverviewSkeleton2 /></div>;
    if (error) return <div className="p-6"><AlertDestructive error={error} /></div>;
    if (!payee) return <div className="p-6 text-center">Payee not found.</div>;

    return (
        <div className="flex max-w-[1200px] flex-col gap-4">
            {/* Name, then the actions under it. */}
            <div className="flex flex-col gap-3">
                <div className="min-w-0">
                    <h1 className="break-words text-2xl font-bold text-primary md:text-3xl">{payee.account_name}</h1>
                    <p className="mt-1.5 text-sm text-zinc-600">{payee.name}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <Button
                        variant="outline"
                        onClick={() => setEditing(true)}
                        className="gap-2 border-primary text-primary hover:bg-primary/5 hover:text-primary"
                    >
                        <PencilLine className="h-4 w-4" />
                        Edit
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setDeleting(true)}
                        className="gap-2 border-destructive text-destructive hover:bg-destructive/5 hover:text-destructive"
                    >
                        <Trash2 className="h-4 w-4" />
                        Delete
                    </Button>
                </div>
            </div>

            <div role="tablist" aria-label="Payee" className="flex overflow-x-auto overflow-y-hidden border-b">
                {payeePageTabs(payee).map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => chooseTab(item.key)}
                        className={cn(
                            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                            tab === item.key
                                ? "border-primary font-medium text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {item.label}
                        {item.count !== undefined && (
                            <span className="ml-1.5 inline-block rounded-full bg-zinc-100 px-[7px] text-xs font-semibold text-zinc-600">
                                {item.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {tab === PAYEE_PAGE_TABS.OVERVIEW && <PayeeOverviewTab payee={payee} />}
            {tab === PAYEE_PAGE_TABS.VENDORS && <PayeeLinkedVendorsTab vendors={payee.linked_vendors} />}

            {editing && (
                <EditPayeeDialog
                    payee={payee}
                    vendors={payee.linked_vendors}
                    endpoint={{ saveApi: EDIT_PAYEE_API, saveArgs: { name: payee.name }, checkApi: CHECK_PAYEE_API }}
                    title="Edit Payee"
                    onClose={() => setEditing(false)}
                    onSaved={() => mutate()}
                />
            )}
            <DeletePayeeDialog
                open={deleting}
                onOpenChange={setDeleting}
                payee={payee}
                onDeleted={() => navigate("/payees")}
            />
        </div>
    );
}

export default function PayeePage() {
    const { payeeId } = useParams<{ payeeId: string }>();
    if (!payeeId) return <div className="p-6 text-center text-destructive">Payee ID is missing.</div>;
    return <PayeeView payeeId={payeeId} />;
}
