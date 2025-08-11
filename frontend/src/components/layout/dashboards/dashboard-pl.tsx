import { Card } from "@/components/ui/card";
import { useDocCountStore } from "@/zustand/useDocCountStore";
import { useFrappeGetDocCount, useFrappeGetDocList } from "frappe-react-sdk";
import { TailSpin } from "react-loader-spinner";
import { Link } from "react-router-dom";

export const ProjectLead = () => {

    const { counts } = useDocCountStore()
    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocCount("Vendors");
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocCount("Items");
    const { data: projects_data, isLoading: projects_loading, error: projects_error } = useFrappeGetDocList("Projects", { limit: 1000 })

    const { data: approved_quotes, isLoading: approved_quotes_loading, error: approved_quotes_error } = useFrappeGetDocCount("Approved Quotations");

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
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/purchase-orders?tab=Approve+Amended+PO">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Amended PO</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">
                                {counts.po["PO Amendment"] || 0}
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
                        <Link to="/products">
                            <p className="text-center py-6 font-bold text-gray-500">Total Products</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6">{(item_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (item_list)}
                                {item_list_error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/item-price">
                            <p className="text-center py-6 font-bold text-gray-500">Item Price Search</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6">{(approved_quotes_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (approved_quotes)}
                                {approved_quotes_error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                </div>
            </div>
        </div>
    );
}