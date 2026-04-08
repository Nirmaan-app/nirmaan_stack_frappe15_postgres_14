import { AlertDestructive } from "@/components/layout/alert-banner/error-alert"
import { Card, CardContent, CardDescription } from "@/components/ui/card"
import { OverviewSkeleton, Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/use-toast"
import { useUserData } from "@/hooks/useUserData"
import { Items } from "@/types/NirmaanStack/Items"
import { useFrappeDocumentEventListener, useFrappeGetDoc, useFrappeGetDocList } from "frappe-react-sdk"
import { FilePenLine } from "lucide-react"
import { useState } from "react"
import { useParams, useLocation } from "react-router-dom"
import React, { Suspense } from "react";
import { TailSpin } from "react-loader-spinner";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice"
import { EditItemDialog } from "./components/EditItemDialog";

interface TargetRates {
    name: string;
    item_id: string;
    unit: string;
    make: string;
    rate: number;
}

const ApprovedQuotationsTable = React.lazy(() => import("../ApprovedQuotationsFlow/ApprovedQuotationsTable"));

const Item = () => {
    const { productId } = useParams<{ productId: string }>()

    if (productId) {
        return <ItemView productId={productId} />
    }
}

export const Component = Item

const ItemView = ({ productId }: { productId: string }) => {

    const userData = useUserData()
    const location = useLocation(); // <--- ADDED: Hook to read URL location
    const queryParams = new URLSearchParams(location.search); // Object to easily read query params
    const unitFromQuery = queryParams.get('unit'); // <--- GET UNIT FROM URL
    const MakeFromQuery = queryParams.get('make'); // <--- GET MAKE FROM URL

    const { data, error, isLoading, mutate } = useFrappeGetDoc<Items>(
        'Items',
        productId,
        `Items ${productId}`,
        {
            revalidateIfStale: false,
        }
    );

    const {
        data: targetRatesList, // Renamed to list to be clearer
        isLoading: targetRatesLoading,
        error: targetRatesError,
    } = useFrappeGetDocList<TargetRates>( // <-- USE YOUR DOCTYPE HERE
        "Target Rates", // <--- YOUR DOCTYPE NAME
        {
            fields: ["*"], // Fetch all fields, including the child table if needed
            filters: [
                ["item_id", "=", productId],
                // ["unit", "=", unitFromQuery],
            ],
            limit: 0, // Only expect one Target Rate document for a unique Item-Unit combination
        },
        productId && `TargetRates_${productId}_${unitFromQuery}_${MakeFromQuery}`
    );

    console.log("targetRatesList", targetRatesList)

    const FilterTargetRateUnit = targetRatesList?.filter((item) => item.unit === unitFromQuery && item.make === MakeFromQuery)

    // console.log("FilterTargetRateUnit",FilterTargetRateUnit)



    useFrappeDocumentEventListener("Items", productId, (event) => {
        console.log("Items document updated (real-time):", event);
        toast({
            title: "Document Updated",
            description: `Items ${event.name} has been modified.`,
        });
        mutate(); // Re-fetch this specific document
    },
        true // emitOpenCloseEventsOnMount (default)
    )



    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);



    if (error) return <AlertDestructive error={error} />

    return (
        <div className="flex-1 md:space-y-4">
            <div className="flex items-center max-md:mb-2">
                {isLoading ? (<Skeleton className="h-10 w-1/3 bg-gray-300" />) :
                    <h2 className="pl-2 text-xl md:text-3xl font-bold tracking-tight">{data?.item_name}</h2>}
                {(userData.role === "Nirmaan Admin Profile" || userData.role === "Nirmaan PMO Executive Profile") && (
                    <FilePenLine
                        className="w-10 text-blue-300 hover:-translate-y-1 transition hover:text-blue-600 cursor-pointer"
                        onClick={() => setIsEditDialogOpen(true)}
                    />
                )}
            </div>
            {isLoading ? <OverviewSkeleton /> : (
                <div>
                    <Card>
                        <CardContent className="flex items-start mt-6">

                            {/* Use a grid to split the content into two columns (50%/50%) */}
                            <div className="grid grid-cols-1 md:grid-cols-2 w-full gap-8">

                                {/* ----------------------- LEFT COLUMN: Primary Details ----------------------- */}
                                <div className="grid grid-cols-2 md:grid-cols-2 gap-x-4 gap-y-4">
                                    <CardDescription className="space-y-2">
                                        <span>Product ID</span>
                                        <p className="font-bold text-black">{data?.name}</p>
                                    </CardDescription>

                                    <CardDescription className="space-y-2">
                                        <span>Category</span>
                                        <p className="font-bold text-black">{data?.category}</p>
                                    </CardDescription>

                                    {/* {unitFromQuery && (
                                        <CardDescription className="space-y-2">
                                            <span>Target Rate</span>
                                            <p className="font-bold text-black">
                                                {FilterTargetRateUnit?.length>0?formatToRoundedIndianRupee(FilterTargetRateUnit[0]?.rate):"N/A"}
                                            </p>
                                        </CardDescription>
                                    )} */}
                                    <CardDescription className="space-y-2">
                                        <span>Unit</span>
                                        {unitFromQuery ? <p className="font-bold text-black">{(FilterTargetRateUnit && FilterTargetRateUnit.length > 0) ? FilterTargetRateUnit[0]?.unit : data?.unit_name}</p> : <p className="font-bold text-black">{data?.unit_name}</p>}
                                    </CardDescription>



                                    <CardDescription className="space-y-2">
                                        <span>Billing Category</span>
                                        <p className="font-bold text-black">{data?.billing_category}</p>
                                    </CardDescription>

                                    <CardDescription className="space-y-2">
                                        <span>Item Status</span>
                                        <p className="font-bold text-black">{data?.item_status}</p>
                                    </CardDescription>

                                    <CardDescription className="space-y-2">
                                        <span>Order Category</span>
                                        <p className="font-bold text-black">{data?.order_category}</p>
                                    </CardDescription>


                                </div>

                                {/* ----------------------- RIGHT COLUMN: All Target Rates List ----------------------- */}
                                <div className="space-y-3  md:border-t-0 md:border-l pl-0 md:pl-4 pt-4 md:pt-0">
                                    <h4 className="font-semibold text-center text-gray-900 border-b pb-1">Today's Rates by Unit</h4>

                                    {/* --- NEW SKELETON CHECK --- */}
                                    {targetRatesLoading ? (
                                        <div className="space-y-2 pt-2">
                                            {/* Render 3-4 rows of skeleton placeholders */}
                                            {[1, 2, 3].map((i) => (
                                                <div key={i} className="flex justify-between items-center text-sm p-1 rounded bg-gray-50">
                                                    {/* Unit Placeholder */}
                                                    <Skeleton className="h-4 w-12 bg-gray-200" />
                                                    {/* Rate Placeholder */}
                                                    <Skeleton className="h-4 w-20 bg-gray-200" />
                                                </div>
                                            ))}
                                            <p className="text-xs text-muted-foreground text-center pt-2">Loading all units...</p>
                                        </div>
                                    ) : targetRatesList?.length > 0 ? (
                                        // --- EXISTING MAPPED LIST (Only runs when not loading) ---
                                        targetRatesList.map((listTarget, i) => {
                                            // Highlight the rate matching the current URL query unit
                                            const isCurrentUnit = unitFromQuery && MakeFromQuery
                                                && listTarget?.unit === unitFromQuery && listTarget?.make === MakeFromQuery

                                            return (
                                                <div key={i} className={`flex justify-between items-center text-sm p-1 rounded ${isCurrentUnit ? 'bg-blue-50 border border-blue-200' : ''}`}>
                                                    <CardDescription className="space-y-1">
                                                        <span className="text-xs">Unit</span>
                                                        <p className={`font-bold ${isCurrentUnit ? 'text-blue-700' : 'text-black'}`}>{listTarget?.unit}</p>
                                                    </CardDescription>
                                                    <CardDescription className="space-y-1">
                                                        <span className="text-xs">Make</span>
                                                        <p className={`font-bold ${isCurrentUnit ? 'text-blue-700' : 'text-black'}`}>{listTarget?.make || "N/A"}</p>
                                                    </CardDescription>

                                                    <CardDescription className="space-y-1 text-right">
                                                        <span className="text-xs">Target Rate</span>
                                                        <p className={`font-bold ${isCurrentUnit ? 'text-blue-700' : 'text-black'}`}>
                                                            {listTarget?.rate > 0 ? formatToRoundedIndianRupee(listTarget?.rate) : "N/A"}

                                                        </p>
                                                    </CardDescription>
                                                </div>
                                            )
                                        })
                                        // --- END EXISTING MAPPED LIST ---
                                    ) : (
                                        <p className="text-muted-foreground italic text-sm">No Target Rates available for this item.</p>
                                    )}


                                </div>
                            </div>
                        </CardContent>

                    </Card>
                </div>
            )}
            <Suspense fallback={<div className="flex items-center h-[90vh] w-full justify-center"><TailSpin color={"red"} /> </div>}>

                <ApprovedQuotationsTable productId={productId} item_name={data?.item_name} />

            </Suspense>

            <EditItemDialog
                item={data as any}
                isOpen={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
                onItemUpdated={mutate}
            />

        </div>
    )
}