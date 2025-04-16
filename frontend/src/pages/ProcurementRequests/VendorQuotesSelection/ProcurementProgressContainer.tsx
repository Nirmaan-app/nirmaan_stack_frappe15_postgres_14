// src/features/procurement/progress/ProcurementProgressContainer.tsx
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TailSpin } from 'react-loader-spinner';
import { Button } from '@/components/ui/button'; // Adjust path
import { useProcurementRequestDoc } from './hooks/useProcurementRequestDoc';
import { useVendorsList } from './hooks/useVendorsList';
import { useProcurementProgressLogic } from './hooks/useProcurementProgressLogic';
import { useUsersList } from './hooks/useUsersList';
import { ProcurementProgressView } from './ProcurementProgressView';

export const ProcurementProgressContainer: React.FC = () => {
    const { prId } = useParams<{ prId: string }>();
    const navigate = useNavigate();

    // --- Ensure prId ---
    if (!prId) {
        return <div className="flex items-center justify-center h-[90vh]">Error: PR ID is missing.</div>;
    }

    // --- Data Fetching ---
    const { data: procurementRequest, isLoading: prLoading, error: prError, mutate: prMutate } = useProcurementRequestDoc(prId);
    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useVendorsList(); // Fetch material/service vendors
    const { data: usersList, isLoading: usersLoading, error: usersError } = useUsersList(); // Fetch users

    // --- Instantiate Logic Hook ---
    // Pass ID, initial data (if loaded), and the specific mutator for the PR doc
    const logicProps = useProcurementProgressLogic({
        prId,
        initialProcurementRequest: procurementRequest,
        vendors,
        usersList,
        prMutate, // Pass the mutate function from useProcurementRequestDoc
    });

    // --- Loading and Error States ---
    const isLoading = prLoading || vendorsLoading || usersLoading; // Initial data load
    const error = prError || vendorsError || usersError;

    console.log("procurementRequest", procurementRequest)

    // --- Render Logic ---
    if (isLoading && !procurementRequest) { // Show spinner only during initial PR load
        return (
            <div className="flex items-center justify-center h-[90vh]">
                <TailSpin color="red" height={50} width={50} />
            </div>
        );
    }

    if (error) {
        console.error("Error loading data:", error);
        return (
             <div className="p-4 flex flex-col items-center justify-center h-[90vh] text-red-600">
                 <p className='mb-2'>Error loading Procurement Request details. Please try again later.</p>
                 <pre className='text-xs bg-red-100 p-2 rounded mb-4 w-full max-w-lg overflow-auto'>{JSON.stringify(error, null, 2)}</pre>
                 <Button onClick={() => navigate("/procurement-requests")} className="mt-4">Go Back</Button>
             </div>
         );
    }

    if (!procurementRequest) {
         // Should be caught above, but for robustness
         return (
             <div className="flex items-center justify-center h-[90vh]">
                 Procurement Request <span className='font-mono mx-1'>{prId}</span> not found.
                 <Button onClick={() => navigate("/procurement-requests")} className="ml-4">Go Back</Button>
             </div>
         );
    }

    // --- Workflow State Check (using logicProps for getFullName) ---
    if (procurementRequest.workflow_state !== "In Progress" && procurementRequest.workflow_state !== "Approved") { // Allow Approved state for potential revert
         const modifierName = logicProps.getFullName(procurementRequest.modified_by) || procurementRequest.modified_by;
         return (
            <div className="flex items-center justify-center h-[90vh]">
                <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center space-y-4">
                    <h2 className="text-2xl font-semibold text-gray-800">Heads Up!</h2>
                    <p className="text-gray-600 text-lg">
                        The PR <span className="font-medium text-gray-900">{procurementRequest.name}</span> is in state:{" "}
                        <span className="font-semibold text-blue-600">{procurementRequest.workflow_state}</span>.
                         RFQ progress/review is applicable for 'In Progress' or 'Approved' states only.
                         Last modified by{" "}
                         <span className="font-medium text-gray-900">{modifierName}</span>.
                    </p>
                     <Button onClick={() => navigate("/procurement-requests")} className="mt-4">Go Back to PR List</Button>
                 </div>
            </div>
        );
    }

    // Render the View component, passing all props from the logic hook
    return <ProcurementProgressView {...logicProps} />;
};

export default ProcurementProgressContainer; // Default export for lazy loading