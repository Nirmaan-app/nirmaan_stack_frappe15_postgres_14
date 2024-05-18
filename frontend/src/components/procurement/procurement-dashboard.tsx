import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { ArrowLeft } from 'lucide-react';

export default function ProcurementDashboard() {
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
    {
        fields:['name','workflow_state']
    });
    console.log("procurement_request_list",procurement_request_list)
    const procurement_request_lists:string[] = [];
    procurement_request_list?.map((item) => {
        if(item.workflow_state === "Approved") procurement_request_lists.push(item.name)
    })

    return (
        <div className="flex">
            <div className="w-1/5 h-[600px] rounded-lg m-1 p-2 border-2 border-gray-300">
                Sidebar Content
            </div>
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <ArrowLeft/>
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Select Vendors</h2>
                </div>
                <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                {[...Array(4)].map((_, index) => (
                    <div key={index} className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/procure-request">
                    <p className="text-center py-6 font-bold text-gray-500">New PR Request</p>
                    <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{procurement_request_lists.length}</p>
                    </Link>
                    </div>
                ))}
                </div>
            </div>
        </div>
    );
}