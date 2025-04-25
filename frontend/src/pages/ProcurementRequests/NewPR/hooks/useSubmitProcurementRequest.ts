// import { useCallback } from 'react';
// import { useNavigate } from 'react-router-dom';
// import { useFrappeCreateDoc, useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';
// import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
// import { useToast } from '@/components/ui/use-toast'; // Adjust path
// import { useUserData } from '@/hooks/useUserData'; // Adjust path

// interface UseSubmitProcurementRequestResult {
//     submitNewPR: () => Promise<void>;
//     resolveOrUpdatePR: () => Promise<void>;
//     cancelDraftPR: () => Promise<void>;
//     isSubmitting: boolean; // Combined loading state
// }

// export const useSubmitProcurementRequest = (): UseSubmitProcurementRequestResult => {
//     const navigate = useNavigate();
//     const { toast } = useToast();
//     const { mutate: globalMutate } = useSWRConfig(); // For refreshing lists elsewhere
//     const userData = useUserData();

//     // Get state needed for submission from the store
//     const {
//         mode,
//         prId,
//         projectId,
//         selectedWP,
//         procList,
//         selectedCategories,
//         newPRComment,
//         resetStore, // Action to clear the store
//     } = useProcurementRequestStore(state => ({
//         mode: state.mode,
//         prId: state.prId,
//         projectId: state.projectId,
//         selectedWP: state.selectedWP,
//         procList: state.procList,
//         selectedCategories: state.selectedCategories,
//         newPRComment: state.newPRComment,
//         resetStore: state.resetStore,
//     }));

//     const { createDoc, loading: createLoading } = useFrappeCreateDoc();
//     const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

//     const isSubmitting = createLoading || updateLoading;

//     // Common logic after successful submission/update
//     const handleSuccess = useCallback(async (docName: string, action: string) => {
//         toast({
//             title: "Success!",
//             description: `PR: ${docName} ${action} successfully!`,
//             variant: "success",
//         });

//         // Refresh relevant SWR caches
//         await globalMutate((key) => typeof key === 'string' && key.startsWith('Procurement Requests'));
//         await globalMutate((key) => typeof key === 'string' && key.startsWith('Procurement Orders'));
//         if (prId) await globalMutate(`Nirmaan Comments ${prId}`); // Refresh comments if editing/resolving

//         resetStore(); // Clear the draft state

//         // Navigate after success
//         if (mode === 'create') {
//             navigate("/prs&milestones/procurement-requests"); // Go to list view
//         } else {
//             navigate(`/prs&milestones/procurement-requests/${docName}`); // Go back to the PR detail view
//         }

//     }, [globalMutate, mode, prId, resetStore, navigate, toast]);

//     // Common logic for adding comments
//     const addCommentIfNeeded = useCallback(async (docType: string, docName: string, subject: string) => {
//         if (newPRComment && userData?.user_id) {
//             try {
//                 await createDoc("Nirmaan Comments", {
//                     comment_type: "Comment",
//                     reference_doctype: docType,
//                     reference_name: docName,
//                     comment_by: userData.user_id,
//                     content: newPRComment,
//                     subject: subject,
//                 });
//             } catch (commentError) {
//                 console.error("Failed to add comment:", commentError);
//                 toast({ title: "Comment Failed", description: "Failed to save comment, but PR was submitted.", variant: "destructive" });
//             }
//         }
//     }, [newPRComment, userData?.user_id, createDoc, toast]);


//     // --- Submission Functions ---

//     const submitNewPR = useCallback(async () => {
//         if (!projectId || !selectedWP || procList.length === 0) {
//             toast({ title: "Missing Information", description: "Project, Work Package, and items are required.", variant: "destructive" });
//             return;
//         }

//         try {
//             const res = await createDoc("Procurement Requests", {
//                 project: projectId,
//                 work_package: selectedWP,
//                 category_list: { list: selectedCategories },
//                 procurement_list: { list: procList },
//                 // Add other necessary fields for creation
//             });
//             await addCommentIfNeeded("Procurement Requests", res.name, "creating pr");
//             await handleSuccess(res.name, "created");

//         } catch (error: any) {
//             console.error("Submit PR Error:", error);
//             toast({ title: "Submission Failed", description: error.message || "Could not create Procurement Request.", variant: "destructive" });
//         }
//     }, [projectId, selectedWP, procList, selectedCategories, newPRComment, createDoc, addCommentIfNeeded, handleSuccess, toast]);


//     const resolveOrUpdatePR = useCallback(async () => {
//         if (!prId || procList.length === 0) {
//             toast({ title: "Missing Information", description: "Cannot update without PR ID or items.", variant: "destructive" });
//             return;
//         }

//         const updateData: any = {
//             category_list: { list: selectedCategories },
//             procurement_list: { list: procList },
//             // Conditionally set workflow state only if resolving a rejected PR
//             ...(mode === 'resolve' && { workflow_state: "Pending" }),
//             // Add other necessary fields for update
//         };

//         try {
//             const res = await updateDoc("Procurement Requests", prId, updateData);
//             await addCommentIfNeeded("Procurement Requests", prId, mode === 'edit' ? "editing pr" : "resolving pr");
//             await handleSuccess(prId, mode === 'edit' ? "updated" : "resolved");

//         } catch (error: any) {
//             console.error("Resolve/Update PR Error:", error);
//             toast({ title: `${mode === 'edit' ? 'Update' : 'Resolve'} Failed`, description: error.message || "Could not update Procurement Request.", variant: "destructive" });
//         }
//     }, [prId, procList, selectedCategories, newPRComment, mode, updateDoc, addCommentIfNeeded, handleSuccess, toast]);


//     const cancelDraftPR = useCallback(async () => {
//         if (mode !== 'edit' || !prId) return; // Only applicable in edit mode

//         try {
//             await updateDoc("Procurement Requests", prId, {
//                 workflow_state: "Pending", // Revert state back from Draft
//             });
//             toast({ title: "Draft Cancelled", description: `PR ${prId} draft changes discarded.`, variant: "default" });
//             resetStore(); // Clear draft state
//             await globalMutate(`Procurement Requests ${prId}`);
//             navigate(`/prs&milestones/procurement-requests/${prId}`); // Go back to detail view

//         } catch (error: any) {
//             console.error("Cancel Draft Error:", error);
//             toast({ title: "Cancellation Failed", description: error.message || "Could not cancel draft.", variant: "destructive" });
//         }
//     }, [mode, prId, updateDoc, navigate, resetStore, globalMutate, toast]);


//     return {
//         submitNewPR,
//         resolveOrUpdatePR,
//         cancelDraftPR,
//         isSubmitting,
//     };
// };


// src/features/procurement-requests/hooks/useSubmitProcurementRequest.ts
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeCreateDoc, useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { useToast } from '@/components/ui/use-toast';
import { useUserData } from '@/hooks/useUserData';

interface UseSubmitProcurementRequestResult {
    submitNewPR: () => Promise<void>;
    resolveOrUpdatePR: () => Promise<void>;
    cancelDraftPR: () => Promise<void>;
    isSubmitting: boolean;
}

export const useSubmitProcurementRequest = (): UseSubmitProcurementRequestResult => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { mutate: globalMutate } = useSWRConfig();
    const userData = useUserData();

    // --- Select state and actions individually from the store ---
    const mode = useProcurementRequestStore(state => state.mode);
    const prId = useProcurementRequestStore(state => state.prId);
    const projectId = useProcurementRequestStore(state => state.projectId);
    const selectedWP = useProcurementRequestStore(state => state.selectedWP);
    const procList = useProcurementRequestStore(state => state.procList);
    const selectedCategories = useProcurementRequestStore(state => state.selectedCategories);
    const newPRComment = useProcurementRequestStore(state => state.newPRComment);
    const resetStore = useProcurementRequestStore(state => state.resetStore);
    // --- End of individual selection ---

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();

    const isSubmitting = createLoading || updateLoading;

    // Common logic after successful submission/update
    const handleSuccess = useCallback(async (docName: string, action: string) => {
        toast({
            title: "Success!",
            description: `PR: ${docName} ${action} successfully!`,
            variant: "success",
        });

        // Refresh relevant SWR caches
        // Use a more robust check for key type if needed
        await globalMutate((key) => typeof key === 'string' && key.startsWith('Procurement Requests'));
        await globalMutate((key) => typeof key === 'string' && key.startsWith('Procurement Orders'));
        if (prId) await globalMutate((key) => typeof key === 'string' && key.startsWith(`Nirmaan Comments ${prId}`));

        resetStore(); // Clear the draft state

        // Navigate after success
        if (mode === 'create') {
            navigate("/prs&milestones/procurement-requests");
        } else {
            // Ensure docName is valid before navigating
            navigate(`/prs&milestones/procurement-requests/${docName || prId}`);
        }

    // Dependencies for handleSuccess: Include all state values used inside it
    }, [globalMutate, mode, prId, resetStore, navigate, toast]);


    // Common logic for adding comments
    const addCommentIfNeeded = useCallback(async (docType: string, docName: string, subject: string) => {
        // Ensure necessary data exists
        if (newPRComment && userData?.user_id && docName) {
            try {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: docType,
                    reference_name: docName,
                    comment_by: userData.user_id,
                    content: newPRComment.trim(), // Trim comment
                    subject: subject,
                });
            } catch (commentError) {
                console.error("Failed to add comment:", commentError);
                toast({ title: "Comment Failed", description: "Failed to save comment, but PR action was successful.", variant: "warning" }); // Adjusted message
            }
        }
    // Dependencies for addCommentIfNeeded
    }, [newPRComment, userData?.user_id, createDoc, toast]);


    // --- Submission Functions ---

    const submitNewPR = useCallback(async () => {
        // Add checks for projectId and selectedWP existence at the time of call
        if (!projectId || !selectedWP || procList.length === 0) {
            toast({ title: "Missing Information", description: "Project, Work Package, and items are required.", variant: "destructive" });
            return;
        }

        try {
            // Ensure procList and selectedCategories are structured correctly for the API
            const payload = {
                project: projectId,
                work_package: selectedWP,
                category_list: JSON.stringify({ list: selectedCategories }), // Stringify if API expects JSON string
                procurement_list: JSON.stringify({ list: procList }),      // Stringify if API expects JSON string
                // Add other necessary fields
            };
             // console.log("Creating PR with payload:", payload); // Debug log
            const res = await createDoc("Procurement Requests", payload);
            await addCommentIfNeeded("Procurement Requests", res.name, "creating pr");
            await handleSuccess(res.name, "created");

        } catch (error: any) {
            console.error("Submit PR Error:", error);
            toast({ title: "Submission Failed", description: error.message || "Could not create Procurement Request.", variant: "destructive" });
        }
    // Dependencies for submitNewPR
    }, [projectId, selectedWP, procList, selectedCategories, newPRComment, createDoc, addCommentIfNeeded, handleSuccess, toast]);


    const resolveOrUpdatePR = useCallback(async () => {
        // Add check for prId existence at the time of call
        if (!prId || procList.length === 0) {
            toast({ title: "Missing Information", description: "Cannot update without PR ID or items.", variant: "destructive" });
            return;
        }

        const updateData: any = {
            // Ensure lists are structured correctly for the API
            category_list: JSON.stringify({ list: selectedCategories }), // Stringify if API expects JSON string
            procurement_list: JSON.stringify({ list: procList }),      // Stringify if API expects JSON string
            ...(mode === 'resolve' && { workflow_state: "Pending" }),
            // Add other necessary fields
        };

        try {
            // console.log("Updating PR", prId, "with payload:", updateData); // Debug log
            // const res = await updateDoc("Procurement Requests", prId, updateData); // updateDoc doesn't usually return the full doc
            await updateDoc("Procurement Requests", prId, updateData);
            await addCommentIfNeeded("Procurement Requests", prId, mode === 'edit' ? "editing pr" : "resolving pr");
            await handleSuccess(prId, mode === 'edit' ? "updated" : "resolved");

        } catch (error: any) {
            console.error("Resolve/Update PR Error:", error);
            toast({ title: `${mode === 'edit' ? 'Update' : 'Resolve'} Failed`, description: error.message || "Could not update Procurement Request.", variant: "destructive" });
        }
    // Dependencies for resolveOrUpdatePR
    }, [prId, procList, selectedCategories, newPRComment, mode, updateDoc, addCommentIfNeeded, handleSuccess, toast]);


    const cancelDraftPR = useCallback(async () => {
        if (mode !== 'edit' || !prId) return;

        try {
            await updateDoc("Procurement Requests", prId, {
                workflow_state: "Pending",
            });
            toast({ title: "Draft Cancelled", description: `PR ${prId} draft changes discarded.`, variant: "default" }); // Using default variant
            resetStore();
            // Ensure mutation happens *before* navigation if possible, or handle potential race conditions
            await globalMutate((key) => typeof key === 'string' && key.startsWith(`Procurement Requests ${prId}`));
            navigate(`/prs&milestones/procurement-requests/${prId}`);

        } catch (error: any) {
            console.error("Cancel Draft Error:", error);
            toast({ title: "Cancellation Failed", description: error.message || "Could not cancel draft.", variant: "destructive" });
        }
     // Dependencies for cancelDraftPR
    }, [mode, prId, updateDoc, navigate, resetStore, globalMutate, toast]);


    return {
        submitNewPR,
        resolveOrUpdatePR,
        cancelDraftPR,
        isSubmitting,
    };
};