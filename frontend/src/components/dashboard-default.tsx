import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { useFrappeGetDocCount } from "frappe-react-sdk";
import { HardHat, UserRound, Briefcase, WalletCards, HandPlatter } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";
import { fetchDocCount } from "@/reactQuery/customFunctions";

export const Default = () => {

    const { data: project_count, isLoading: project_count_loading, error: project_count_error } = useFrappeGetDocCount("Projects");

    const { data: user_count, isLoading: user_count_loading, error: user_count_error } = useFrappeGetDocCount("Nirmaan Users");

    // const { data: role_count, isLoading: role_count_loading, error: role_count_error } = useFrappeGetDocCount("Nirmaan Roles");

    const { data: wp_count, isLoading: wp_count_loading, error: wp_count_error } = useFrappeGetDocCount("Work Packages");

    // const { data: pr_count, isLoading: pr_count_loading, error: pr_count_error } = useFrappeGetDocCount("Procurement Requests");

    const { data: items_count, isLoading: items_count_loading, error: items_count_error } = useFrappeGetDocCount("Items");

    const { data: vendors_count, isLoading: vendors_count_loading, error: vendors_count_error } = useFrappeGetDocCount("Vendors");

    const {data : customers_count, isLoading: customers_count_loading, error: customers_count_error} = useQuery({
        queryKey: ["docCount", "Customers"],
        queryFn: () => fetchDocCount("Customers"),
        staleTime: 1000 * 60 * 5,
    })

    

    return (
        <>
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                {/* <div className="flex items-center justify-between space-y-2">
                    <Breadcrumb>
                        <BreadcrumbItem isCurrentPage>
                            <BreadcrumbLink href="/wp">
                                Dashboard
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </Breadcrumb>
                </div> */}
                <div className="flex items-center justify-between space-y-2 pl-2">
                    <h2 className="text-3xl text-[#D03B45] font-bold tracking-tight">Modules List</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <Card className="hover:animate-shadow-drop-center" data-cy="admin-dashboard-project-card" >
                        <Link to="/projects">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Total Projects
                                </CardTitle>
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(project_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                        : (project_count)}
                                    {project_count_error && <p>Error</p>}
                                </div>
                                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                            </CardContent>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/users">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Total Users
                                </CardTitle>
                                <UserRound className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(user_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : (user_count)}
                                    {user_count_error && <p>Error</p>}
                                </div>
                                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                            </CardContent>
                        </Link>
                    </Card>
                    {/* <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/roles">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Total Roles
                                </CardTitle>
                                <PersonStanding className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(role_count_loading) ? (<p>Loading</p>) : (role_count)}
                                    {role_count_error && <p>Error</p>}
                                </div>
                                <p className="text-xs text-muted-foreground">COUNT</p>
                            </CardContent>
                        </Link>
                    </Card> */}
                    <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/wp">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Total Work Packages
                                </CardTitle>
                                <Briefcase className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(wp_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : (wp_count)}
                                    {wp_count_error && <p>Error</p>}
                                </div>
                                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                            </CardContent>
                        </Link>
                    </Card>
                    {/* <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/procurement-requests">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Procurement Requests
                                </CardTitle>
                                <WalletCards className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(pr_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                        : (pr_count)}
                                    {pr_count_error && <p>Error</p>}
                                </div>
                                <p className="text-xs text-muted-foreground">COUNT</p>
                            </CardContent>
                        </Link>
                    </Card> */}
                    <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/items">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Items
                                </CardTitle>
                                <WalletCards className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(items_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                        : (items_count)}
                                    {items_count_error && <p>Error</p>}
                                </div>
                                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                            </CardContent>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/vendors">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Vendors
                                </CardTitle>
                                <WalletCards className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(vendors_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                        : (vendors_count)}
                                    {vendors_count_error && <p>Error</p>}
                                </div>
                                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                            </CardContent>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center" >
                        <Link to="/customers">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Total Customers
                                </CardTitle>
                                <HandPlatter className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {(customers_count_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />) : (customers_count)}
                                    {customers_count_error && <p>Error</p>}
                                </div>
                                {/* <p className="text-xs text-muted-foreground">COUNT</p> */}
                            </CardContent>
                        </Link>
                    </Card>
                </div>
            </div>
        </>
    )
}