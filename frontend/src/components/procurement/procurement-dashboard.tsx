import {  useFrappeGetDocCount, useFrappeGetDocList } from "frappe-react-sdk";
import { Link, useNavigate } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { CirclePlus } from "lucide-react";
import { useDocCountStore } from "@/zustand/useDocCountStore";

export default function ProcurementDashboard() {

    const navigate = useNavigate()
    const { approvedPRCount, updateQuotePRCount, chooseVendorPRCount, newPOCount, otherPOCount, newSBCounts, allSRCount, pendingSRCount, approvedSRCount } = useDocCountStore()

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocCount("Vendors");
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocCount("Items");
    const { data: projects_data, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList("Projects")

    return (
        <div className="flex-1 md:space-y-4 space-y-4">
            <div className="flex justify-between items-center space-y-2">
                <h2 className="text-2xl max-md:text-xl font-bold tracking-tight">Procurement Dashboard</h2>
                <div className="flex gap-2 max-sm:flex-col">
                    <Button onClick={() => navigate("/prs&milestones/procurement-request")} className="flex"><CirclePlus className="w-5 h-5 mt- pr-1" />Urgent PR</Button>
                    <Button onClick={() => navigate("/service-request")} className="flex"><CirclePlus className="w-5 h-5 mt- pr-1" />Service Request</Button>
                </div>

            </div>
            <div className="flex items-center space-y-2">
                <h2 className=" font-bold tracking-tight">New PR Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/procure-request">
                        <p className="text-center py-6 font-bold text-gray-500">New PR Request</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {approvedPRCount || 0}
                        </p>
                    </Link>
                </Card>

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/update-quote">
                        <p className="text-center py-6 font-bold text-gray-500">Update Quote</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {updateQuotePRCount || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/select-vendor-list">
                        <p className="text-center py-6 font-bold text-gray-500">Choose Vendor</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {chooseVendorPRCount || 0}
                        </p>
                    </Link>
                </Card>
            </div>
            <div className="flex items-center space-y-2">
                <h2 className=" font-bold tracking-tight">Service Requests</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/service-request">
                        <p className="text-center py-6 font-bold text-gray-500">All SRs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {allSRCount || 0}
                        </p>
                    </Link>
                </Card>

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/select-service-vendor">
                        <p className="text-center py-6 font-bold text-gray-500">Select SR Vendor</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {pendingSRCount || 0}
                        </p>
                    </Link>
                </Card>

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/approved-sr">
                        <p className="text-center py-6 font-bold text-gray-500">Approved SR</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {approvedSRCount || 0}
                        </p>
                    </Link>
                </Card>
            </div>
            <div className="flex items-center space-y-2">
                <h2 className="text-base pt-1 font-bold tracking-tight">PO Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/release-po">
                        <p className="text-center py-6 font-bold text-gray-500">Approved PO</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {newPOCount || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/released-po">
                        <p className="text-center py-6 font-bold text-gray-500">Released PO</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {otherPOCount || 0}
                        </p>
                    </Link>
                </Card>
            </div>
            <div className="flex items-center space-y-2">
                <h2 className="text-base pt-1 font-bold tracking-tight">Sent Back PR Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/rejected-sb">
                        <p className="text-center py-6 font-bold text-gray-500">Rejected Sent Backs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {newSBCounts.rejected || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/delayed-sb">
                        <p className="text-center py-6 font-bold text-gray-500">Delayed Sent Backs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {newSBCounts.delayed || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/cancelled-sb">
                        <p className="text-center py-6 font-bold text-gray-500">Cancelled Sent Backs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                            {newSBCounts.cancelled || 0}
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
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(projects_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (projects_data?.length)}
                            {projects_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/vendors">
                        <p className="text-center py-6 font-bold text-gray-500">Total Vendors</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(vendor_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (vendor_list)}
                            {vendor_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/items">
                        <p className="text-center py-6 font-bold text-gray-500">Total Items</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(item_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (item_list)}
                            {item_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
            </div>
        </div>
    );
}