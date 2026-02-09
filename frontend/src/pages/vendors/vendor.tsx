import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ConfigProvider, Menu, MenuProps } from "antd";
import { useFrappeGetDocList } from 'frappe-react-sdk';

import { useVendorData } from './hooks/useVendorData';
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Projects } from "@/types/NirmaanStack/Projects";
import { ProcurementRequest } from "@/types/NirmaanStack/ProcurementRequests";
import { Category } from "@/types/NirmaanStack/Category";
import { OverviewSkeleton2 } from "@/components/ui/skeleton";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { FilePenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditVendor } from "./edit-vendor";
import { getUrlStringParam } from "@/hooks/useServerDataTable";
import { urlStateManager } from "@/utils/urlStateManager";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useUserData } from "@/hooks/useUserData";

const VendorOverviewCard = React.lazy(() => import("./components/VendorOverviewCard"));
const VendorBankDetailsCard = React.lazy(() => import("./components/VendorBankDetailsCard"));
const VendorMaterialOrdersTable = React.lazy(() => import("./components/VendorMaterialOrdersTable"));
const VendorPaymentsTable = React.lazy(() => import("./components/VendorPaymentsTable"));
const VendorApprovedQuotesTable = React.lazy(() => import("./components/VendorApprovedQuotesTable"));
const FinalizedSRList = React.lazy(() => import("../ServiceRequests/service-request/finalized-sr-list"));
const POVendorLedger = React.lazy(() => import("./components/POVendorLedger"));
const PoInvoices = React.lazy(() => import("../tasks/invoices/components/PoInvoices").then(m => ({ default: m.PoInvoices })));
const SrInvoices = React.lazy(() => import("../tasks/invoices/components/SrInvoices").then(m => ({ default: m.SrInvoices })));

type MenuItem = Required<MenuProps>["items"][number];

export const VendorView: React.FC<{ vendorId: string }> = ({ vendorId }) => {

    const { role } = useUserData()

    // --- Tab State Management ---
    const initialTab = useMemo(() => {
        // Determine initial tab based on role, default to "Approved PO" if not admin/lead
        const defaultTab = "overview";
        return getUrlStringParam("tab", defaultTab);
    }, []); // Calculate only once based on role

    const [currentTab, setCurrentTab] = useState(initialTab);
    const [editSheetOpen, setEditSheetOpen] = useState(false);
    const toggleEditSheet = useCallback(() => setEditSheetOpen(prev => !prev), []);

    // Effect to sync tab state TO URL
    useEffect(() => {
        // Only update URL if the state `tab` is different from the URL's current 'tab' param
        if (urlStateManager.getParam("tab") !== currentTab) {
            urlStateManager.updateParam("tab", currentTab);
        }
    }, [currentTab]);

    // Effect to sync URL state TO tab state (for popstate/direct URL load)
    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            // Update state only if the new URL value is different from current state
            const newTab = value || initialTab; // Fallback to initial if param removed
            if (currentTab !== newTab) {
                setCurrentTab(newTab);
            }
        });
        return unsubscribe; // Cleanup subscription
    }, [initialTab]); // Depend on `tab` to avoid stale closures

    // --- Main Vendor Data ---
    const { vendor, vendorAddress, isLoading: vendorLoading, error: vendorError, mutateVendor } = useVendorData(vendorId);

    // --- Supporting Data for Tables (fetch once here, pass as props) ---
    const { data: projects } = useFrappeGetDocList<Projects>(
        "Projects", { fields: ["name", "project_name"], limit: 0 }
    );
    const projectOptions = useMemo(() =>
        projects?.map(p => ({ label: p.project_name, value: p.name })) || [],
        [projects]);

    const { data: procurementRequests } = useFrappeGetDocList<ProcurementRequest>(
        "Procurement Requests", { fields: ["name", "work_package"], limit: 0 } // Fetch only what's needed by tables
    );
    const { data: allCategories } = useFrappeGetDocList<Category>( // For VendorOverviewCard
        "Category", { fields: ["name", "work_package", "category_name"], limit: 0 }
    );


    const menuItems: MenuItem[] = useMemo(() => [
        { label: "Overview", key: "overview" },
        // (vendor?.vendor_type !== "Service") &&
        { label: "Vendor Ledger", key: "poVendorLedger" },
        (vendor?.vendor_type === "Material" || vendor?.vendor_type === "Material & Service") &&
        { label: "Material Orders", key: "materialOrders" },
        (vendor?.vendor_type === "Service" || vendor?.vendor_type === "Material & Service") &&
        { label: "Service Orders", key: "serviceOrders" },
        { label: "Payments", key: "vendorPayments" },
        (vendor?.vendor_type !== "Service") &&
        { label: "Approved Quotes", key: "approvedQuotes" },
        (vendor?.vendor_type === "Material" || vendor?.vendor_type === "Material & Service") &&
        { label: "PO Invoices", key: "poInvoices" },
        (vendor?.vendor_type === "Service" || vendor?.vendor_type === "Material & Service") &&
        { label: "SR Invoices", key: "srInvoices" },

    ].filter(Boolean) as MenuItem[], [vendor?.vendor_type]);

    const handleMenuClick: MenuProps["onClick"] = useCallback(e => setCurrentTab(e.key), []);


    if (vendorLoading) return <div className="p-6"><OverviewSkeleton2 /></div>;
    if (vendorError) return <div className="p-6"><AlertDestructive error={vendorError} /></div>;
    if (!vendor) return <div className="p-6 text-center">Vendor not found.</div>;


    const renderTabContent = () => {
        switch (currentTab) {
            case "overview":
                return (
                    <div className="space-y-4">
                        <VendorOverviewCard
                            vendor={vendor}
                            vendorAddress={vendorAddress}
                            allCategories={allCategories}
                        />
                        <VendorBankDetailsCard vendor={vendor} mutateVendor={mutateVendor} />
                    </div>
                );
            case "materialOrders":
                return <VendorMaterialOrdersTable
                    vendorId={vendorId}
                    projectOptions={projectOptions}
                    procurementRequests={procurementRequests}
                />;
            case "serviceOrders":
                return <FinalizedSRList for_vendor={vendorId} />; // Use your existing component
            case "vendorPayments":
                return <VendorPaymentsTable
                    vendorId={vendorId}
                    projectOptions={projectOptions}
                />;
            case "approvedQuotes":
                return <VendorApprovedQuotesTable
                    vendorId={vendorId}
                />;
            case "poVendorLedger":
                return <POVendorLedger vendorId={vendorId} />
            case "poInvoices":
                return <PoInvoices vendorId={vendorId} />;
            case "srInvoices":
                return <SrInvoices vendorId={vendorId} />;
            default:
                return <div>Select a tab.</div>;
        }
    };

    return (
        <div className="flex-1 space-y-2 md:space-y-4">
            {/* Header with Vendor Name and Edit Button can be its own component */}
            <div className="flex items-center gap-1 mb-4">
                <div className="flex items-baseline gap-2 ml-4">
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-primary">
                        {vendor?.vendor_name || vendor?.vendor_nickname}
                    </h2>
                    {vendor?.vendor_nickname && (
                        <span className="text-sm md:text-base text-muted-foreground">
                            ({vendor?.vendor_nickname})
                        </span>
                    )}
                </div>
                {role !== "Nirmaan Project Manager Profile" &&
                    (<Button variant="ghost" size="icon" onClick={toggleEditSheet} aria-label="Edit Vendor Details">
                        <FilePenLine className="h-5 w-5 text-blue-500 hover:text-blue-700" />
                    </Button>)
                }
            </div>

            <ConfigProvider
                theme={{
                    components: {
                        Menu: {
                            horizontalItemSelectedColor: "#D03B45",
                            itemSelectedBg: "#FFD3CC",
                            itemSelectedColor: "#D03B45",
                        },
                    },
                }}
            >
                <Menu selectedKeys={[currentTab]} onClick={handleMenuClick} mode="horizontal" items={menuItems} />
            </ConfigProvider>

            <div className="mt-6">
                <Suspense fallback={<LoadingFallback />}>
                    {renderTabContent()}
                </Suspense>
            </div>

            <Sheet open={editSheetOpen} onOpenChange={setEditSheetOpen}>
                <SheetContent className="overflow-auto w-full sm:max-w-xl md:max-w-2xl"> {/* Responsive width */}
                    <EditVendor toggleEditSheet={toggleEditSheet} />
                </SheetContent>
            </Sheet>
        </div>
    );
};

// Main export for the page
const VendorPage = () => {
    const { vendorId } = useParams<{ vendorId: string }>();
    if (!vendorId) return <div className="p-6 text-center text-destructive">Vendor ID is missing.</div>;
    return <VendorView vendorId={vendorId} />;
};
export const Component = VendorPage; // For file-based routing
export default VendorPage; // Default export