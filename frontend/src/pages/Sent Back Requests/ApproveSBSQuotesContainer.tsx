// src/features/procurement/approve-sb-quotes/ApproveSBSQuotesContainer.tsx
import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button'; // Adjust path
import { ApproveSBSQuotesView } from './ApproveSBSQuotesView';

// import { useNirmaanComments } from '@/hooks/useNirmaanComments'; // Reuse/Adapt
import { useApproveSBSLogic } from './hooks/useApproveSBSLogic'; // Use SB logic hook
import { NirmaanComments } from '@/types/NirmaanStack/NirmaanComments'; // Adjust path
import { useVendorsList } from '../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList';
import { useApprovedQuotationsList } from '../ProcurementRequests/ApproveVendorQuotes/hooks/useApprovedQuotationsList';
import { useFrappeDocumentEventListener, useFrappeGetDocList } from 'frappe-react-sdk';
import { ProcurementItem } from '@/types/NirmaanStack/ProcurementRequests';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { useUsersList } from '../ProcurementRequests/ApproveNewPR/hooks/useUsersList';
import { toast } from '@/components/ui/use-toast';
import { useSentBackCategory } from "@/hooks/useSentBackCategory";

export const ApproveSBSQuotesContainer: React.FC = () => {
    const { id: sbId } = useParams<{ id: string }>(); // Use sbId
    const navigate = useNavigate();

    // --- Ensure sbId ---
    if (!sbId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: Sent Back ID is missing.</div>;
    }

    // --- Data Fetching ---
    // Use the specific hook for Sent Back Category
    const { data: sbData, isLoading: sbLoading, error: sbError, mutate: sbMutate } = useSentBackCategory(sbId);

    useFrappeDocumentEventListener("Sent Back Category", sbId, (event) => {
          console.log("Sent Back Category document updated (real-time):", event);
          toast({
              title: "Document Updated",
              description: `Sent Back Category ${event.name} has been modified.`,
          });
          sbMutate(); // Re-fetch this specific document
        },
        true // emitOpenCloseEventsOnMount (default)
    )

    const { data: vendorList, isLoading: vendorsLoading, error: vendorsError } = useVendorsList();
    const { data: usersList, isLoading: usersLoading, error: usersError } = useUsersList();
    const { data: quotesData, isLoading: quotesLoading, error: quotesError } = useApprovedQuotationsList();

    const { data: universalComment, isLoading: universalCommentLoading, error: universalCommentError } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
      fields: ["*"],
      filters: [["reference_name", "=", sbData?.name], ["subject", "=", "sb vendors selected"]]
  },
  sbData ? undefined : null
)

    const sbEditableLogic = useMemo(() => {
          const stateCheck = ["Vendor Selected", "Partially Approved"].includes(sbData?.workflow_state || "")
          const pendingItemsCheck = (typeof sbData?.item_list === "string" ? JSON.parse(sbData?.item_list) : sbData?.item_list)?.list?.some((i: ProcurementItem) => i?.status === "Pending")
    
          return stateCheck && pendingItemsCheck
        } ,[sbData])
    // const { data: commentsData, isLoading: commentsLoading, error: commentsError } = useNirmaanComments({ docname: sbId, doctype: 'Sent Back Category', subject: 'sb vendors selected' });

    // --- Instantiate Logic Hook ---
    const logicProps = useApproveSBSLogic({
        sbId,
        initialSbData: sbData, // Pass SB data
        vendorList,
        quotesData,
        usersList,
        sbMutate, // Pass SB mutate
        // Pass commentsData if needed
    });

    // --- Loading and Error States ---
    const isLoading = sbLoading || vendorsLoading || usersLoading || quotesLoading || universalCommentLoading /* || commentsLoading */;
    const error = sbError || vendorsError || usersError || quotesError || universalCommentError /* || commentsError */;

    // --- Render Logic ---
    if (isLoading) { // Check initial SB data load
        return (
            <LoadingFallback />
        );
    }

    if (error) {
        console.error("Error loading data for SB quote approval:", error);
        return (
             <div className="p-4 flex flex-col items-center justify-center h-[90vh] text-red-600">
                 <p className='mb-2'>Error loading details. Please try again later.</p>
                 <pre className='text-xs bg-red-100 p-2 rounded mb-4 w-full max-w-lg overflow-auto'>{JSON.stringify(error, null, 2)}</pre>
                 {/* Adjust nav target */}
                 <Button onClick={() => navigate("/purchase-orders?tab=Approve Sent Back PO")} className="mt-4">Go Back</Button>
             </div>
         );
    }

     if (!sbData) {
          return (
              <div className="flex items-center justify-center h-[90vh]">
                  Sent Back Record <span className='font-mono mx-1'>{sbId}</span> not found.
                  <Button onClick={() => navigate("/purchase-orders?tab=Approve Sent Back PO")} className="ml-4">Go Back</Button>
              </div>
          );
      }

    // --- Workflow State Check ---
    // Relies on logicProps.isSbEditable which checks workflow state internally
    if (!sbEditableLogic) {
         const modifierName = usersList?.find(u => u.name === sbData.modified_by)?.full_name || sbData.modified_by;
         return (
            <div className="flex items-center justify-center h-[90vh]">
                <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                    <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
                    <p className="text-gray-600 text-lg">
                        The Sent Back record <span className="font-medium text-gray-900">{sbData.name}</span> is in state:{" "}
                        <span className="font-semibold text-blue-600">{sbData.workflow_state}</span>.
                         Actions are only available in 'Vendor Selected' or 'Partially Approved' states.
                         Last modified by{" "}
                         <span className="font-medium text-gray-900">{modifierName}</span>.
                    </p>
                     <Button onClick={() => navigate("/purchase-orders?tab=Approve Sent Back PO")} className="mt-4">Go Back</Button>
                 </div>
            </div>
        );
     }


    // Render the View component
    return (
        <ApproveSBSQuotesView
            {...logicProps}
            // Pass any extra props needed only by the view
            // Pass actual comments data here
            sbComments={universalComment || []} // Replace with actual comments data
            getUserName={(id) => usersList?.find(u => u.name === id)?.full_name || id || "N/A"} // Example user name lookup
        />
    );
};

export default ApproveSBSQuotesContainer; // Default export