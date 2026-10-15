/**
 * `/payees/:payeeId` (#1423, spec #1420, approved mockup screen 2): one Payee.
 *
 * Its holder name, ID and status, then three tabs: Payee Overview (the bank account card and "At a
 * glance"), Linked Vendors and Linked Expenses, the last two with counts on their labels. Edit holder
 * name opens `EditHolderNameDialog` (mockup screen 4); Mark inactive / Mark active opens
 * `SetPayeeStatusDialog`.
 *
 * Everything shown comes from `api/payees/payee_page.get_payee`, which reads the Payee module
 * (`services/payees/links.payee_page`). Accountant, Accountant Lead and Admin only: the route guard
 * reads `PAYEE_MANAGE_PROFILES`, and the server enforces it on every endpoint.
 */

import { useState } from "react";
import { PencilLine } from "lucide-react";
import { useParams } from "react-router-dom";

import { EditHolderNameDialog } from "@/components/payees/EditHolderNameDialog";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Button } from "@/components/ui/button";
import { OverviewSkeleton2 } from "@/components/ui/skeleton";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { cn } from "@/lib/utils";
import { PAYEE_STATUS } from "@/types/NirmaanStack/Payee";
import {
    PAYEE_PAGE_TAB_PARAM,
    PAYEE_PAGE_TABS,
    isPayeePageTab,
    payeePageTabs,
    type PayeePageTab,
} from "@/utils/payees/payeePage";
import { urlStateManager } from "@/utils/urlStateManager";

import { PayeeLinkedExpensesTab } from "./components/PayeeLinkedExpensesTab";
import { PayeeLinkedVendorsTab } from "./components/PayeeLinkedVendorsTab";
import { PayeeOverviewTab } from "./components/PayeeOverviewTab";
import { SetPayeeStatusDialog } from "./components/SetPayeeStatusDialog";
import { usePayeePage } from "./hooks/usePayeePage";

function PayeeView({ payeeId }: { payeeId: string }) {
    const { payee, error, isLoading, mutate } = usePayeePage(payeeId);
    const [tab, setTab] = useState<PayeePageTab>(() => {
        const fromUrl = getUrlStringParam(PAYEE_PAGE_TAB_PARAM, PAYEE_PAGE_TABS.OVERVIEW);
        return isPayeePageTab(fromUrl) ? fromUrl : PAYEE_PAGE_TABS.OVERVIEW;
    });
    const [editingHolder, setEditingHolder] = useState(false);
    const [changingStatus, setChangingStatus] = useState(false);

    const chooseTab = (next: PayeePageTab) => {
        setTab(next);
        urlStateManager.updateParam(PAYEE_PAGE_TAB_PARAM, next);
    };

    if (isLoading) return <div className="p-6"><OverviewSkeleton2 /></div>;
    if (error) return <div className="p-6"><AlertDestructive error={error} /></div>;
    if (!payee) return <div className="p-6 text-center">Payee not found.</div>;

    const active = payee.status === PAYEE_STATUS.ACTIVE;

    return (
        <div className="flex max-w-[1200px] flex-col gap-4">
            {/* Name, then the actions under it, whatever the status: the buttons never move. */}
            <div className="flex flex-col gap-3">
                <div className="min-w-0">
                    <h1 className="break-words text-2xl font-bold text-primary md:text-3xl">{payee.account_name}</h1>
                    <p className="mt-1.5 flex items-center gap-2 text-sm text-zinc-600">
                        {payee.name}
                        <span
                            className={cn(
                                "rounded-md border px-2 py-0.5 text-xs font-semibold",
                                active ? "border-green-300 bg-green-50 text-green-700" : "border-zinc-300 bg-zinc-100 text-zinc-600",
                            )}
                        >
                            {payee.status}
                        </span>
                    </p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <Button
                        variant="outline"
                        onClick={() => setEditingHolder(true)}
                        className="gap-2 border-primary text-primary hover:bg-primary/5 hover:text-primary"
                    >
                        <PencilLine className="h-4 w-4" />
                        Edit holder name
                    </Button>
                    <Button variant="outline" onClick={() => setChangingStatus(true)}>
                        {active ? "Mark inactive" : "Mark active"}
                    </Button>
                </div>
            </div>

            {!active && (
                <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[13px] text-zinc-700">
                    This payee is inactive: nobody can pick it for a vendor or an expense. Records already pointing at it keep it.
                </p>
            )}

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
            {tab === PAYEE_PAGE_TABS.EXPENSES && <PayeeLinkedExpensesTab expenses={payee.linked_expenses} />}

            <EditHolderNameDialog
                open={editingHolder}
                onOpenChange={setEditingHolder}
                payee={payee}
                onSaved={() => mutate()}
            />
            <SetPayeeStatusDialog
                open={changingStatus}
                onOpenChange={setChangingStatus}
                payee={payee}
                onSaved={() => mutate()}
                onShowVendors={() => {
                    setChangingStatus(false);
                    chooseTab(PAYEE_PAGE_TABS.VENDORS);
                }}
            />
        </div>
    );
}

export default function PayeePage() {
    const { payeeId } = useParams<{ payeeId: string }>();
    if (!payeeId) return <div className="p-6 text-center text-destructive">Payee ID is missing.</div>;
    return <PayeeView payeeId={payeeId} />;
}
