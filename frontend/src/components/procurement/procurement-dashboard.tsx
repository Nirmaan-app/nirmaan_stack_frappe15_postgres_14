import { useFrappeGetDocCount, useFrappeGetDocList } from "frappe-react-sdk";
import { Link, useNavigate } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { CirclePlus } from "lucide-react";
import { useDocCountStore } from "@/zustand/useDocCountStore";

export default function ProcurementDashboard() {

    const { approvedPRCount, updateQuotePRCount, chooseVendorPRCount, newPOCount, otherPOCount, newSBCounts, allSRCount, pendingSRCount, approvedSRCount } = useDocCountStore()

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocCount("Vendors");
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocCount("Items");
    const { data: projects_data, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList("Projects")

    const { data: approved_quotes, isLoading: approved_quotes_loading, error: approved_quotes_error } = useFrappeGetDocCount("Approved Quotations");

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex justify-between items-center space-y-2">
                <h2 className="text-2xl max-md:text-xl font-bold tracking-tight">Procurement Dashboard</h2>
                <div className="flex gap-2 max-sm:flex-col">
                    <Button onClick={() => navigate("/prs&milestones/procurement-requests")} className="flex"><CirclePlus className="w-5 h-5 mt- pr-1" />Urgent PR</Button>
                    <Button onClick={() => navigate("/service-requests")} className="flex"><CirclePlus className="w-5 h-5 mt- pr-1" />Service Request</Button>
                </div>

            </div> */}
            <div className="flex items-center space-y-2">
                <h2 className=" font-bold tracking-tight">New PR Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/procurement-requests?tab=New+PR+Request">
                        <p className="text-center py-6 font-bold text-gray-500">New PR Request</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
                            {approvedPRCount || 0}
                        </p>
                    </Link>
                </Card>

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/procurement-requests?tab=Update+Quote">
                        <p className="text-center py-6 font-bold text-gray-500">Update Quote</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
                            {updateQuotePRCount || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/procurement-requests?tab=Choose+Vendor">
                        <p className="text-center py-6 font-bold text-gray-500">Choose Vendor</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
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
                    <Link to="/service-requests">
                        <p className="text-center py-6 font-bold text-gray-500">All SRs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
                            {allSRCount || 0}
                        </p>
                    </Link>
                </Card>

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/choose-service-vendor">
                        <p className="text-center py-6 font-bold text-gray-500">Select SR Vendor</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
                            {pendingSRCount || 0}
                        </p>
                    </Link>
                </Card>

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/approved-sr">
                        <p className="text-center py-6 font-bold text-gray-500">Approved SR</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
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
                    <Link to="/purchase-orders?tab=Approved+PO">
                        <p className="text-center py-6 font-bold text-gray-500">Approved PO</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
                            {newPOCount || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/purchase-orders?tab=Released+PO">
                        <p className="text-center py-6 font-bold text-gray-500">Released PO</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
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
                    <Link to="/sent-back-requests?type=Rejected">
                        <p className="text-center py-6 font-bold text-gray-500">Rejected Sent Backs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
                            {newSBCounts.rejected || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/sent-back-requests?type=Delayed">
                        <p className="text-center py-6 font-bold text-gray-500">Delayed Sent Backs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
                            {newSBCounts.delayed || 0}
                        </p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/sent-back-requests?type=Cancelled">
                        <p className="text-center py-6 font-bold text-gray-500">Cancelled Sent Backs</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">
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
                        <p className="text-center text-red-400 text-xl font-bold py-6">{(projects_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (projects_data?.length)}
                            {projects_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/vendors">
                        <p className="text-center py-6 font-bold text-gray-500">Total Vendors</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">{(vendor_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (vendor_list)}
                            {vendor_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/items">
                        <p className="text-center py-6 font-bold text-gray-500">Total Items</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">{(item_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (item_list)}
                            {item_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/approved-quotes">
                        <p className="text-center py-6 font-bold text-gray-500">Approved Quotations</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6">{(approved_quotes_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (approved_quotes)}
                            {approved_quotes_error && <p>Error</p>}</p>
                    </Link>
                </Card>
            </div>
        </div>
    );
}