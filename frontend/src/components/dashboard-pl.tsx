import { useFrappeDocTypeEventListener, useFrappeGetDocList } from "frappe-react-sdk";
import { Link } from "react-router-dom";
import { Card } from "./ui/card";
import { TailSpin } from "react-loader-spinner";
import { MainLayout } from "./layout/main-layout";

export const ProjectLead = () => {

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: procurement_request_list_mutate } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state'],
            limit: 100
        });
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error, mutate: sent_back_list_mutate } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['name'],
            filters: [["workflow_state", "=", "Vendor Selected"]],
            limit: 100
        });

    const pending_procurement_requests: string[] = [];
    const vendor_selected_procurement_request: string[] = [];


    procurement_request_list?.map((item) => {
        if (item.workflow_state === "Pending") pending_procurement_requests.push(item.name)
    })
    procurement_request_list?.map((item) => {
        if (item.workflow_state === "Vendor Selected") vendor_selected_procurement_request.push(item.name)
    })

    useFrappeDocTypeEventListener("Procurement Requests", () => {
        procurement_request_list_mutate()
    })
    useFrappeDocTypeEventListener("Sent Back Category", () => {
        sent_back_list_mutate()
    })

    return (
        // <MainLayout>
        <div className="flex">
            <div className="flex-1 space-x-2 md:space-y-4 p-4 md:p-8 pt-6">
                <div className="flex items-center space-y-2">
                    <h2 className="text-2xl pt-1 pl-2 pb-4 font-bold tracking-tight">Project Lead Dashboard</h2>
                </div>
                <div className="flex items-center space-y-2">
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">New Procurement Actions</h2>
                </div>
                <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-order">
                            <p className="text-center py-6 font-bold text-gray-500">Approve PR</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(procurement_request_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (pending_procurement_requests.length)}
                                {procurement_request_list_error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-vendor">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Vendor</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(procurement_request_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (vendor_selected_procurement_request.length)}
                                {procurement_request_list_error && <p>Error</p>}</p>
                        </Link>
                    </Card>

                </div>
                <div className="flex items-center space-y-2">
                    <h2 className="text-base pt-1 pl-2 pb-4 font-bold tracking-tight">Delayed/Rejected Procurement Actions</h2>
                </div>
                <div className="grid grid-cols-5 gap-4 border border-gray-100 rounded-lg p-4">
                    <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                        <Link to="/approve-sent-back">
                            <p className="text-center py-6 font-bold text-gray-500">Approve Sent Back</p>
                            <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(sent_back_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                                : (sent_back_list?.length)}
                                {sent_back_list_error && <p>Error</p>}</p>
                        </Link>
                    </Card>
                </div>
            </div>
        </div>
        // </MainLayout>
    );
}