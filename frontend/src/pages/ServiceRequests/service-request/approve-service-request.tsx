import { ProcurementActionsHeaderCard } from "@/components/helpers/ProcurementActionsHeaderCard"
import { RenderPRorSBComments } from "@/components/helpers/RenderPRorSBComments"
import LoadingFallback from "@/components/layout/loaders/LoadingFallback"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "@/components/ui/use-toast"
import { useUserData } from "@/hooks/useUserData"
import { useUsersList } from "@/pages/ProcurementRequests/ApproveNewPR/hooks/useUsersList"
import { NirmaanComments } from "@/types/NirmaanStack/NirmaanComments"
import { ServiceItemType } from "@/types/NirmaanStack/ServiceRequests"
import { parseNumber } from "@/utils/parseNumber"
import { useFrappeCreateDoc, useFrappeDocumentEventListener, useFrappeGetDoc, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk"
import { CheckCheck, ListChecks, ListX, Store, Undo2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { TailSpin } from "react-loader-spinner"
import { useNavigate, useParams } from "react-router-dom"
import { ServiceItemsAccordion, type ServiceItem } from "../sr-form/components"

export const ApproveServiceRequest: React.FC = () => {
    const { srId: id } = useParams<{ srId: string }>()

    if (!id) return <div>No Service Request ID Provided</div>

    const navigate = useNavigate()
    const [serviceOrderData, setServiceOrderData] = useState<ServiceItem[] | null>(null)
    const [isLoading, setIsLoading] = useState<string | null>(null);
    const [comment, setComment] = useState('')
    const userData = useUserData()

    const { data: service_request, isLoading: service_request_loading, mutate: srMutate } = useFrappeGetDoc("Service Requests", id)

    useFrappeDocumentEventListener("Service Requests", id, (event) => {
        console.log("Service Requests document updated (real-time):", event);
        toast({
            title: "Document Updated",
            description: `Service Requests ${event.name} has been modified.`,
        });
        srMutate(); // Re-fetch this specific document
    },
        true // emitOpenCloseEventsOnMount (default)
    )

    const { data: serviceVendor, isLoading: serviceVendor_loading } = useFrappeGetDoc("Vendors", service_request?.vendor, service_request ? service_request?.vendor : null)

    const { data: usersList, isLoading: usersListLoading } = useUsersList()

    const { data: universalComment, isLoading: universalCommentLoading } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
        fields: ["*"],
        filters: [["reference_name", "=", id]]
    },
        id ? undefined : null
    )

    const { createDoc: createDoc } = useFrappeCreateDoc()
    const { updateDoc: updateDoc } = useFrappeUpdateDoc()

    // const getUserName = (id) => {
    //     if (usersList) {
    //         return usersList.find((user) => user?.name === id)?.full_name
    //     }
    // }

    // Parse service order data from the document
    useEffect(() => {
        if (service_request?.service_order_list) {
            try {
                const parsed = typeof service_request.service_order_list === 'string'
                    ? JSON.parse(service_request.service_order_list)
                    : service_request.service_order_list;

                // Convert to ServiceItem format with numbers
                const items: ServiceItem[] = (parsed?.list || []).map((item: ServiceItemType) => ({
                    id: item.id,
                    category: item.category,
                    description: item.description,
                    uom: item.uom,
                    quantity: parseNumber(item.quantity),
                    rate: parseNumber(item.rate),
                }));

                setServiceOrderData(items);
            } catch (e) {
                console.error("Failed to parse service_order_list:", e);
                setServiceOrderData([]);
            }
        }
    }, [service_request]);

    const handleApprove = async () => {
        try {
            setIsLoading("approveSR")
            await updateDoc("Service Requests", id, {
                status: "Approved"
            })

            toast({
                title: "Success!",
                description: `SR: ${id} Approved successfully!`,
                variant: "success",
            });

            navigate("/service-requests?tab=approve-service-order");

        } catch (error) {
            toast({
                title: "Failed!",
                description: `Unable to approve services!`,
                variant: "destructive",
            });
            console.log("error while approving sr", error)
        } finally {
            setIsLoading(null);
        }
    }

    const handleReject = async () => {
        try {
            setIsLoading("rejectSR")
            await updateDoc("Service Requests", id, {
                status: "Rejected"
            })

            if (comment) {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: "Service Requests",
                    reference_name: id,
                    comment_by: userData?.user_id,
                    content: comment,
                    subject: "rejecting sr"
                })
            }

            toast({
                title: "Success!",
                description: `SR: ${id} Rejected successfully!`,
                variant: "success",
            });

            navigate("/service-requests?tab=approve-service-order");

        } catch (error) {
            toast({
                title: "Failed!",
                description: `Unable to reject services!`,
                variant: "destructive",
            });
            console.log("error while rejecting sr", error)
        } finally {
            setIsLoading(null);
            setComment('')
        }
    }

    const getUserName = useCallback((id: string | undefined) => {
        return usersList?.find((user) => user?.name === id)?.full_name || ""
    }, [usersList]);

    if (serviceVendor_loading || service_request_loading || usersListLoading || universalCommentLoading) {
        return (
            <LoadingFallback />
        )
    }


    if (service_request?.status !== "Vendor Selected") return (
        <div className="flex items-center justify-center h-[90vh]">
            <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                <h2 className="text-2xl font-semibold text-gray-800">
                    Heads Up!
                </h2>
                <p className="text-gray-600 text-lg">
                    Hey there, the SR:{" "}
                    <span className="font-medium text-gray-900">{service_request?.name}</span>{" "}
                    is no longer available for{" "}
                    <span className="italic">Reviewing</span>. The current state is{" "}
                    <span className="font-semibold text-blue-600">
                        {service_request?.status}
                    </span>{" "}
                    And the last modification was done by <span className="font-medium text-gray-900">
                        {service_request?.modified_by === "Administrator" ? service_request?.modified_by : getUserName(service_request?.modified_by)}
                    </span>
                    !
                </p>
                <button
                    className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                    onClick={() => navigate("/service-requests?tab=approve-service-order")}
                >
                    Go Back
                </button>
            </div>
        </div>
    );

    return (
        <div className="flex-1 space-y-4">
            <div className="space-y-2">
                <h2 className="text-base pl-2 font-bold tracking-tight text-pageheader">Approve/Reject</h2>
                <ProcurementActionsHeaderCard orderData={service_request} sr={true} />
            </div>

            {/* Vendor Info Card */}
            <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="py-3 px-4 border-b border-primary/10">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Store className="h-4 w-4 text-primary" />
                        Selected Vendor
                    </CardTitle>
                </CardHeader>
                <CardContent className="py-3 px-4">
                    <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                            <span className="text-muted-foreground">Name:</span>{" "}
                            <span className="font-medium">{serviceVendor?.vendor_name}</span>
                        </div>
                        {serviceVendor?.vendor_city && (
                            <div>
                                <span className="text-muted-foreground">City:</span>{" "}
                                <span>{serviceVendor.vendor_city}</span>
                            </div>
                        )}
                        {serviceVendor?.vendor_state && (
                            <div>
                                <span className="text-muted-foreground">State:</span>{" "}
                                <span>{serviceVendor.vendor_state}</span>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Service Items Accordion - grouped by category with totals */}
            {serviceOrderData && serviceOrderData.length > 0 && (
                <ServiceItemsAccordion
                    items={serviceOrderData}
                    defaultExpanded={true}
                />
            )}

            <div className="flex justify-end gap-2 mr-2 mt-2">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant={"outline"} className="text-red-500 border-red-500 flex items-center gap-1">
                            <ListX className="h-4 w-4" />
                            Reject
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Add Comments and Reject.
                                <div className="py-2"><label htmlFor="textarea" >Comment:</label></div>
                                <textarea
                                    id="textarea"
                                    className="w-full border rounded-lg p-2"
                                    value={comment}
                                    placeholder="type here..."
                                    onChange={(e) => setComment(e.target.value)}
                                />
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {isLoading === "rejectSR" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter className="flex flex-row justify-center gap-2 items-center">
                                <AlertDialogCancel className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={handleReject} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                    </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant={"outline"} className='text-red-500 border-red-500 flex gap-1 items-center'>
                            <ListChecks className="h-4 w-4" />
                            Approve
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-[425px]">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you Sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Click on Confirm to Approve.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {isLoading === "approveSR" ? <div className='flex items-center justify-center'><TailSpin width={80} color='red' /> </div> : (
                            <AlertDialogFooter className="flex flex-row justify-center gap-2 items-center">
                                <AlertDialogCancel className="flex items-center gap-1">
                                    <Undo2 className="h-4 w-4" />
                                    Cancel
                                </AlertDialogCancel>
                                <Button onClick={handleApprove} className="flex items-center gap-1">
                                    <CheckCheck className="h-4 w-4" />
                                    Confirm
                                </Button>
                            </AlertDialogFooter>
                        )}
                    </AlertDialogContent>
                </AlertDialog>
            </div>
            <div className='space-y-2'>
                <h2 className="text-base pl-2 font-bold tracking-tight">SR Comments</h2>
                <RenderPRorSBComments universalComment={universalComment} getUserName={getUserName} />
            </div>
        </div>
    )
}


export default ApproveServiceRequest;