import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCounts } from "@/hooks/useCounts";
import { CheckCircle2, Coins, FileText, HardHat, ShoppingCart, Store } from "lucide-react";
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

    const { data, isLoading } = useCounts(
        [
            { key: "projects", doctype: "Projects" },
            { key: "approvedQuotes", doctype: "Approved Quotations" },
            { key: "purchaseOrders", doctype: "Procurement Orders", filters: [["status", "not in", ["Merged"]]] },
            { key: "vendors", doctype: "Vendors" },
            { key: "tds", doctype: "TDS Repository" },
            { key: "approvedWO", doctype: "Service Requests", filters: [["status", "=", "Approved"]] },
        ],
        "dashboard-estimates-executive-counts"
    );

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
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (data?.message?.projects as number)}
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
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (data?.message?.approvedQuotes as number)}
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
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (data?.message?.approvedWO as number)}
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
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (data?.message?.purchaseOrders as number)}
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
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (data?.message?.vendors as number)}
                            </div>
                        </CardContent>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center">
                    <Link to="/tds-repository">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                TDS Repository
                            </CardTitle>
                            <FileText className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                    : (data?.message?.tds as number)}
                            </div>
                        </CardContent>
                    </Link>
                </Card>
            </div>
        </>
    )
}

