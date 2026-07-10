import { Card } from "@/components/ui/card";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useCounts } from "@/hooks/useCounts";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";

export const ProjectLead = () => {

    const { counts } = useDocCountStore()
    const { data, isLoading, error } = useCounts(
        [
            { key: "projects", doctype: "Projects" },
            { key: "vendors", doctype: "Vendors" },
            { key: "items", doctype: "Items" },
            { key: "approvedQuotes", doctype: "Approved Quotations" },
        ],
        "dashboard-pl-counts"
    );

    return (
        <div className="flex-1 space-y-4">
            <div className=" space-y-2">
                <h2 className="text-base font-bold tracking-tight">Procurement Actions</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/prs&milestones">
                            <p className="text-center py-6 font-bold text-gray-500">PRs and Milestones</p>
                            <p className="text-center text-red-400 text-sm font-light py-6 font-bold text-gray-500">Create/View PRs, update Milestones & DNs</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/procurement-requests?tab=Approve+PR">
                            <p className="text-center py-6 font-bold text-gray-500">Approve PR</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {counts.pr.pending || 0}
                            </p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/purchase-orders?tab=Approve+PO">
                            <p className="text-center py-6 font-bold text-gray-500">Approve PO</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {counts.pr.approve || 0}
                            </p>
                        </Link>
                    </Card>

                </div>
                <h2 className="text-base font-bold tracking-tight pt-4">Rejected/Delayed/Cancelled Sent Back Actions</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/purchase-orders?tab=Approve+Sent+Back+PO">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Sent Back</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {counts.sb.approve || 0}
                            </p>
                        </Link>
                    </Card>
                </div>
                <div className="flex items-center space-y-2">
                    <h2 className="text-base pt-1 font-bold tracking-tight">General Actions</h2>
                </div>
                <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/projects">
                            <p className="text-center py-6 font-bold text-gray-500">Projects Assigned</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6">{(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (data?.message?.projects as number)}
                                {error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/vendors">
                            <p className="text-center py-6 font-bold text-gray-500">Total Vendors</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6">{(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (data?.message?.vendors as number)}
                                {error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/products">
                            <p className="text-center py-6 font-bold text-gray-500">Total Products</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6">{(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (data?.message?.items as number)}
                                {error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/item-price">
                            <p className="text-center py-6 font-bold text-gray-500">Item Price Search</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6">{(isLoading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (data?.message?.approvedQuotes as number)}
                                {error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/critical-po-tracker">
                            <p className="text-center py-6 font-bold text-gray-500">PO Tracker</p>
                            <p className="text-center text-red-400 text-sm font-light py-6 font-bold text-gray-500">Track critical PO releases</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/work-plan-tracker">
                            <p className="text-center py-6 font-bold text-gray-500">Work Plan Tracker</p>
                            <p className="text-center text-red-400 text-sm font-light py-6 font-bold text-gray-500">Track work plans across projects</p>
                        </Link>
                    </Card>
                </div>
            </div>
        </div>
    );
}