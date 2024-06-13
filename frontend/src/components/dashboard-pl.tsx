import { useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { ArrowLeft } from 'lucide-react';
import { Sidebar } from "./sidebar-nav";
import { useUserData } from "@/hooks/useUserData";

export const ProjectLead = () => {
    const userData = useUserData();
    
    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state'],
            filters: [["project_lead","=",userData.user_id]],
            limit: 100
        });
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['name','item_list', 'workflow_state','procurement_request','category','project_name','vendor','creation','owner'],
            filters:[["workflow_state","=","Vendor Selected"],["owner","=",userData.user_id]],
            limit: 100
        });

    const procurement_request_lists: string[] = [];
    const procurement_request_lists2: string[] = [];


    procurement_request_list?.map((item) => {
        if (item.workflow_state === "Pending") procurement_request_lists.push(item.name)
    })
    procurement_request_list?.map((item) => {
        if (item.workflow_state === "Vendor Selected") procurement_request_lists2.push(item.name)
    })

    return (
        <div className="flex">
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Dashboard</h2>
                </div>
                <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    <div className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-order">
                            <p className="text-center py-6 font-bold text-gray-500">Approve PR</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{procurement_request_lists.length}</p>
                        </Link>
                    </div>
                    <div className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-vendor">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Vendor</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{procurement_request_lists2.length}</p>
                        </Link>
                    </div>
                    <div className="border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-sent-back">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Sent Back</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{sent_back_list?.length}</p>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}