import {  Coins, HardHat, ShoppingCart, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "./ui/button";
import { CardHeader, CardTitle, Card, CardContent } from "./ui/card";
import { TailSpin } from "react-loader-spinner";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useFrappeGetDocCount, useFrappeGetDocList } from "frappe-react-sdk";
import { useUserData } from "@/hooks/useUserData";


export const EstimatesExecutive = () => {

    const {role, user_id} = useUserData()

    const { data: projectPermissions } = useFrappeGetDocList("Nirmaan User Permissions", {
        fields: ["for_value"],
        filters: [["allow", "=", "Projects"], ["user", "=", user_id]],
        limit: 10000
    },
        user_id === "Administrator" || role === "Nirmaan Admin Profile" ? null : undefined
    )

    const permissionsList = projectPermissions?.map((i) => i?.for_value)

    const { data: projectsData, isLoading: projectsDataLoading } = useFrappeGetDocList("Projects", {
        fields: ["*"],
        filters: [["name", "in", permissionsList || []]],
        limit: 10000
    },
        (user_id === "Administrator" || !permissionsList) ? null : undefined
    )

    const { data: approved_quotes, isLoading: approved_quotes_loading } = useFrappeGetDocCount("Approved Quotations");

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
                        <Link to="/approved-quotes">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Approved Quotations
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
            </div>
        </>
    )
}

