import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { ArrowLeft } from 'lucide-react';
import { MainLayout } from "../layout/main-layout";
import { useUserData } from "@/hooks/useUserData";


export default function ProcurementDashboard() {
    const userData = useUserData();
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state'],
            filters: [["workflow_state", "=", "Approved"],["procurement_executive","=",userData.user_id]]
        });
    const { data: procurement_request_list2, isLoading: procurement_request_list2_loading, error: procurement_request_list2_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state'],
            filters: [["workflow_state", "=", "RFQ Generated"],["procurement_executive","=",userData.user_id]]
        });
    const { data: procurement_request_list3, isLoading: procurement_request_list3_loading, error: procurement_request_list3_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state'],
            filters: [["workflow_state", "=", "Quote Updated"],["procurement_executive","=",userData.user_id]]
        });
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['name', 'workflow_state'],
            filters: [["workflow_state", "=", "Pending"],["procurement_executive","=",userData.user_id]]
        });
    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ['name']
        });

    return (
        <div className="flex">

            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    {/* <ArrowLeft /> */}
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Dashboard</h2>
                </div>
                <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    {[...Array(1)].map((_, index) => (
                        <div key={index} className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                            <Link to="/procure-request">
                                <p className="text-center py-6 font-bold text-gray-500">New PR Request</p>
                                <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{procurement_request_list?.length}</p>
                            </Link>
                        </div>
                    ))}
                    <div className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/update-quote">
                            <p className="text-center py-6 font-bold text-gray-500">Update Quote</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{procurement_request_list2?.length}</p>
                        </Link>
                    </div>
                    <div className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/select-vendor-list">
                            <p className="text-center py-6 font-bold text-gray-500">Select Vendors</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{procurement_request_list3?.length}</p>
                        </Link>
                    </div>
                    <div className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/sent-back-request">
                            <p className="text-center py-6 font-bold text-gray-500">Sent Back Request</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{sent_back_list?.length}</p>
                        </Link>
                    </div>
                    <div className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/release-po">
                            <p className="text-center py-6 font-bold text-gray-500">Release PO</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{procurement_order_list?.length}</p>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}