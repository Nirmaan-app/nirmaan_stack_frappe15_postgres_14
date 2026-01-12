import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useFrappeGetDocCount, useFrappeGetDocList } from "frappe-react-sdk";
import { CheckCircle2, Coins, HardHat, ShoppingCart, Store } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";

export const EstimatesExecutive = () => {

    // const {role, user_id} = useUserData()

    // const { data: projectPermissions } = useFrappeGetDocList("Nirmaan User Permissions", {
    //     fields: ["for_value"],
    //     filters: [["allow", "=", "Projects"], ["user", "=", user_id]],
    //     limit: 10000
    // },
    //     user_id === "Administrator" || role === "Nirmaan Admin Profile" ? null : undefined
    // )

    // const permissionsList = projectPermissions?.map((i) => i?.for_value)

    const { data: projectsData, isLoading: projectsDataLoading } = useFrappeGetDocList<Projects>("Projects", {
        fields: ["name"],
        // filters: [["name", "in", permissionsList || []]],
        limit: 10000
    },
        // (user_id === "Administrator" || !permissionsList) ? null : undefined
    )

    const { data: approved_quotes, isLoading: approved_quotes_loading } = useFrappeGetDocCount("Approved Quotations");

    const { data: PO_COUNT, isLoading: PO_COUNT_LOADING } = useFrappeGetDocList<ProcurementOrder>("Procurement Orders", {
        fields: ["name"],
        filters: [["status", "not in", ["Merged", "PO Amendment"]]],
        limit: 100000
    },
    )

    const { data: vendorsCount, isLoading: vendorsCountLoading } = useFrappeGetDocCount("Vendors");

    // Approved Work Orders count
    const { data: approvedWOCount, isLoading: approvedWOCountLoading } = useFrappeGetDocCount("Service Requests", [["status", "=", "Approved"]]);

    return (
        <>
            <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
                </div>
                <Card className="hover:animate-shadow-drop-center">
                    <Link to="/projects">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Projects
                            </CardTitle>
                            <HardHat className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(projectsDataLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (projectsData?.length)}
                            </div>
                            {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                        </CardContent>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center">
                    <Link to="/item-price">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Item Price Search
                            </CardTitle>
                            <Coins className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(approved_quotes_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (approved_quotes)}
                            </div>
                            {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                        </CardContent>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center">
                    <Link to="/service-requests?tab=approved-sr">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Approved WO
                            </CardTitle>
                            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(approvedWOCountLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (approvedWOCount)}
                            </div>
                        </CardContent>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center">
                    <Link to="/purchase-orders">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Purchase Orders
                            </CardTitle>
                            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(PO_COUNT_LOADING) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (PO_COUNT?.length)}
                            </div>
                            {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                        </CardContent>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center">
                    <Link to="/vendors">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Vendors
                            </CardTitle>
                            <Store className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(vendorsCountLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (vendorsCount)}
                            </div>
                            {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                        </CardContent>
                    </Link>
                </Card>
            </div>
        </>
    )
}

