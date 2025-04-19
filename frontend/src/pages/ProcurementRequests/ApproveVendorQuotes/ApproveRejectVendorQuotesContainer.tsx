// src/features/procurement/approve-reject-quotes/ApproveRejectVendorQuotesContainer.tsx
import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TailSpin } from 'react-loader-spinner';
import { Button } from '@/components/ui/button'; // Adjust path
import { useApproveRejectPRDoc } from './hooks/useApproveRejectPRDoc';
import { useApprovedQuotationsList } from './hooks/useApprovedQuotationsList';
// Import useNirmaanComments hook (assuming it exists and is adapted)
// import { useNirmaanComments } from '@/hooks/useNirmaanComments';
import { useApproveRejectLogic } from './hooks/useApproveRejectLogic';
import { NirmaanComments } from '@/types/NirmaanStack/NirmaanComments'; // Type needed for comments hook if used separately
import { useVendorsList } from '../VendorQuotesSelection/hooks/useVendorsList';
import { useUsersList } from '../VendorQuotesSelection/hooks/useUsersList';
import { ApproveRejectVendorQuotesView } from './ApproveRejectVendorQuotesView';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { ProcurementItem } from '@/types/NirmaanStack/ProcurementRequests';

export const ApproveRejectVendorQuotesContainer: React.FC = () => {
    const { id: prId } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // --- Ensure prId ---
    if (!prId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
    }

    // --- Data Fetching ---
    const { data: prData, isLoading: prLoading, error: prError, mutate: prMutate } = useApproveRejectPRDoc(prId);
    const { data: vendorList, isLoading: vendorsLoading, error: vendorsError } = useVendorsList();
    const { data: usersList, isLoading: usersLoading, error: usersError } = useUsersList();
    const { data: quotesData, isLoading: quotesLoading, error: quotesError } = useApprovedQuotationsList();

    const prEditableLogic = useMemo(() => {
      const stateCheck = ["Vendor Selected", "Partially Approved"].includes(prData?.workflow_state || "")
      const pendingItemsCheck = (typeof prData?.procurement_list === "string" ? JSON.parse(prData?.procurement_list) : prData?.procurement_list)?.list?.some((i: ProcurementItem) => i?.status === "Pending")

      return stateCheck && pendingItemsCheck
    } ,[prData])
    // Add comments fetching hook call here if separated
    // const { data: commentsData, isLoading: commentsLoading, error: commentsError } = useNirmaanComments({ docname: prId, doctype: 'Procurement Requests', /* other filters */ });

    const { data: universalComment, isLoading: universalCommentLoading, error: universalCommentError } = useFrappeGetDocList<NirmaanComments>("Nirmaan Comments", {
            fields: ["*"],
            filters: [["reference_name", "=", prId], ["subject", "in", prData?.work_package ? ["pr vendors selected"] : ["new custom pr", "resolved custom pr"]]]
        },
        prData ? undefined : null
      )

    // console.log("prData", prData)

    // --- Instantiate Logic Hook ---
    const logicProps = useApproveRejectLogic({
        prId,
        initialPrData: prData,
        vendorList,
        quotesData,
        usersList,
        prMutate, // Pass the specific mutate function
        // Pass commentsData if fetched separately
    });

    // --- Loading and Error States ---
    const isLoading = prLoading || vendorsLoading || usersLoading || quotesLoading || universalCommentLoading /* || commentsLoading */;
    const error = prError || vendorsError || usersError || quotesError || universalCommentError /* || commentsError */;

    // --- Render Logic ---
    if (isLoading) { // Initial PR load check
        return (
            <LoadingFallback />
        );
    }

    if (error) {
        console.error("Error loading data for quote approval:", error);
        return (
             <div className="p-4 flex flex-col items-center justify-center h-[90vh] text-red-600">
                 <p className='mb-2'>Error loading details for approval. Please try again later.</p>
                 <pre className='text-xs bg-red-100 p-2 rounded mb-4 w-full max-w-lg overflow-auto'>{JSON.stringify(error, null, 2)}</pre>
                 <Button onClick={() => navigate("/purchase-orders?tab=Approve PO")} className="mt-4">Go Back</Button> {/* Adjust nav destination */}
             </div>
         );
    }

     if (!prData) {
          // After loading finishes without error, but prData is still missing
          return (
              <div className="flex items-center justify-center h-[90vh]">
                  Procurement Request <span className='font-mono mx-1'>{prId}</span> not found or is inaccessible.
                  <Button onClick={() => navigate("/purchase-orders?tab=Approve PO")} className="ml-4">Go Back</Button> {/* Adjust nav destination */}
              </div>
          );
      }

    // --- Workflow State Check (performed within logic hook's `isPrEditable` state) ---
    // We rely on the logic hook to determine if actions are allowed.
    // The initial check in the old code can be removed or adapted if needed outside the main view.

    if (!prEditableLogic) return (
      <div className="flex items-center justify-center h-[90vh]">
          <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
              <h2 className="text-2xl font-semibold text-gray-800">
                  Heads Up!
              </h2>
              <p className="text-gray-600 text-lg">
                  Hey there, the PR:{" "}
                  <span className="font-medium text-gray-900">{prData?.name}</span>{" "}
                  is no longer available for{" "}
                  <span className="italic">Reviewing</span>. The current state is{" "}
                  <span className="font-semibold text-blue-600">
                      {prData?.workflow_state}
                  </span>{" "}
                  And the last modification was done by <span className="font-medium text-gray-900">
                      {prData?.modified_by === "Administrator" ? prData?.modified_by : logicProps.getUserName(prData?.modified_by)}
                  </span>
                  !
              </p>
              <button
                  className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors duration-300"
                  onClick={() => navigate("/purchase-orders?tab=Approve PO")}
              >
                  Go Back
              </button>
          </div>
      </div>
  );

    // Render the View component
    return (
        <ApproveRejectVendorQuotesView
            {...logicProps}
            prData={prData}
            // Pass any extra props needed only by the view
            prComments={universalComment || []} // Replace with commentsData if fetched separately
            // getUserName={(id: string | undefined) => logicProps.getVendorName(id)} // Adjust if getUserName logic differs
            attachment={null} // Pass attachment data if fetched separately
            handleAttachmentClick={() => {}} // Pass attachment click handler if needed
            // Pass delayed items if calculated separately or handle within view/logic hook
        />
    );
};

export default ApproveRejectVendorQuotesContainer;