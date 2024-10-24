import { useFrappeDocTypeEventListener, useFrappeGetDocCount, useFrappeGetDocList } from "frappe-react-sdk";
import { Link, useNavigate } from "react-router-dom";
import { TailSpin } from "react-loader-spinner";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { CirclePlus } from "lucide-react";


export default function ProcurementDashboard() {

    const navigate = useNavigate()

    const { data: procurement_request_list, isLoading: procurement_request_list_loading, error: procurement_request_list_error, mutate: procurement_request_list_mutate } = useFrappeGetDocList("Procurement Requests",
        {
            fields: ['name', 'workflow_state'],
            limit: 1000
        });
    const { data: sent_back_list, isLoading: sent_back_list_loading, error: sent_back_list_error, mutate: sent_back_list_mutate } = useFrappeGetDocList("Sent Back Category",
        {
            fields: ['name', 'workflow_state'],
            filters: [["workflow_state", "=", "Pending"]],
            limit: 1000
        });
    const { data: procurement_order_list, isLoading: procurement_order_list_loading, error: procurement_order_list_error, mutate: procurement_order_list_mutate } = useFrappeGetDocList("Procurement Orders",
        {
            fields: ['name'],
            limit: 10000
        });

    const { data: vendor_list, isLoading: vendor_list_loading, error: vendor_list_error } = useFrappeGetDocCount("Vendors");
    const { data: item_list, isLoading: item_list_loading, error: item_list_error } = useFrappeGetDocCount("Items");

    const approved_procurement_requests: string[] = []
    const rfq_generated_procurement_requests: string[] = []
    const quote_updated_procurement_requests: string[] = []
    const approved_pos: string[] = []
    const released_pos: string[] = []

    procurement_request_list?.map((item) => {
        if (item.workflow_state === "Approved") approved_procurement_requests.push(item.name)
    })
    procurement_request_list?.map((item) => {
        if (item.workflow_state === "RFQ Generated") rfq_generated_procurement_requests.push(item.name)
    })
    procurement_request_list?.map((item) => {
        if (item.workflow_state === "Quote Updated") quote_updated_procurement_requests.push(item.name)
    })

    procurement_order_list?.map((item) => {
        if (item.status === "PO Approved") approved_pos.push(item.name)
    })
    procurement_order_list?.map((item) => {
        if (item.status !== "PO Approved") released_pos.push(item.name)
    })

    useFrappeDocTypeEventListener("Procurement Requests", async () => {
        await procurement_request_list_mutate()
    })
    useFrappeDocTypeEventListener("Sent Back Category", async () => {
        await sent_back_list_mutate()
    })
    useFrappeDocTypeEventListener("Procurement Orders", async () => {
        await procurement_order_list_mutate()
    })

    return (
        <div className="flex-1 md:space-y-4 space-y-4">
            <div className="flex justify-between items-center space-y-2">
                <h2 className="text-2xl max-md:text-xl font-bold tracking-tight">Procurement Dashboard</h2>
                <Button onClick={() => navigate("/procurement-request")} className="flex"><CirclePlus className="w-5 h-5 mt- pr-1" />Urgent PR</Button>
            </div>
            <div className="flex items-center space-y-2">
                <h2 className=" font-bold tracking-tight">New PR Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/procure-request">
                        <p className="text-center py-6 font-bold text-gray-500">New PR Request</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(procurement_request_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (approved_procurement_requests.length)}
                            {procurement_request_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>

                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/update-quote">
                        <p className="text-center py-6 font-bold text-gray-500">Update Quote</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(procurement_request_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (rfq_generated_procurement_requests.length)}
                            {procurement_request_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/select-vendor-list">
                        <p className="text-center py-6 font-bold text-gray-500">Select Vendors</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(procurement_request_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (quote_updated_procurement_requests.length)}
                            {procurement_request_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <div className="flex">
                    <Separator orientation="vertical" className="mr-4 flex-grow-0 max-sm:hidden" />
                    <div className="flex-grow">

                    </div>
                </div>
            </div>
            <div className="flex items-center space-y-2">
                <h2 className="text-base pt-1 font-bold tracking-tight">PO Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/release-po">
                        <p className="text-center py-6 font-bold text-gray-500">Approved PO</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(procurement_order_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (approved_pos?.length)}
                            {procurement_order_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/released-po">
                        <p className="text-center py-6 font-bold text-gray-500">Released PO</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(procurement_order_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (released_pos?.length)}
                            {procurement_order_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
            </div>
            <div className="flex items-center space-y-2">
                <h2 className="text-base pt-1 font-bold tracking-tight">Sent Back PR Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
                <Card className="hover:animate-shadow-drop-center border-red-400 rounded-lg border-2 flex flex-col items-center justify-center">
                    <Link to="/sent-back-request">
                        <p className="text-center py-6 font-bold text-gray-500">Sent Back Request</p>
                        <p className="text-center text-red-400 text-xl font-bold py-6 font-bold text-gray-500">{(sent_back_list_loading) ? (<TailSpin visible={true} height="30" width="30" color="#D03B45" ariaLabel="tail-spin-loading" radius="1" wrapperStyle={{}} wrapperClass="" />)
                            : (sent_back_list?.length)}
                            {sent_back_list_error && <p>Error</p>}</p>
                    </Link>
                </Card>
            </div>
            {/* <div className="flex items-center space-y-2">
                    <h2 className="text-base pt-1 font-bold tracking-tight">Generated Order Actions</h2>
                </div>
                <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">

                </div> */}
            <div className="flex items-center space-y-2">
                <h2 className="text-base pt-1 font-bold tracking-tight">General Actions</h2>
            </div>
            <div className="grid xl:grid-cols-5 max-sm:grid-cols-3 grid-cols-4 gap-4 border border-gray-100 rounded-lg p-4">
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