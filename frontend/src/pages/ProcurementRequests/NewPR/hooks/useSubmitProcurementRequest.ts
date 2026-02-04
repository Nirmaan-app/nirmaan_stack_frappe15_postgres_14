// src/features/procurement-requests/hooks/useSubmitProcurementRequest.ts
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFrappeCreateDoc, useFrappeUpdateDoc, useSWRConfig } from 'frappe-react-sdk';
import { useProcurementRequestStore } from '../store/useProcurementRequestStore';
import { useToast } from '@/components/ui/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { useCEOHoldGuard } from '@/hooks/useCEOHoldGuard';
import {
    addWorkflowBreadcrumb,
    captureWorkflowError,
    isNetworkError,
    startWorkflowTransaction,
} from '@/utils/sentry';
import { BackendPRItemDetail, CategorySelection, ProcurementRequestItem } from '../types';

interface UseSubmitProcurementRequestResult {
    submitNewPR: (finalCommentFromDialog: string) => Promise<void>;
    resolveOrUpdatePR: (finalCommentFromDialog: string) => Promise<void>;
    cancelDraftPR: () => Promise<void>;
    isSubmitting: boolean;
}

// Helper to transform frontend items to backend child table format
const transformToBackendOrderList = (frontendProcList: ProcurementRequestItem[]): Omit<BackendPRItemDetail, 'name' | 'creation' | 'modified' | 'parent' | 'parentfield' | 'parenttype'>[] => {
    return frontendProcList.map(feItem => ({
        //uniqueId is client-side, Frappe assigns 'name' to child row on save
        item_id: feItem.status === "Request" ? "" : feItem.name,       // Frontend 'name' is Item DocName
        item_name: feItem.item,     // Frontend 'item' is display name
        unit: feItem.unit,
        quantity: feItem.quantity,
        category: feItem.category,
        procurement_package: feItem.work_package, // map work_package
        make: feItem.make,
        status: feItem.status,
        tax: feItem.tax, // Ensure this matches backend expectation (optional or required)
        comment: feItem.comment,
        // Frappe handles parent, parentfield, parenttype, name, creation, modified for child table items
    }));
};


export const useSubmitProcurementRequest = (): UseSubmitProcurementRequestResult => {
    const navigate = useNavigate();
    const { toast } = useToast();

    const { mutate: globalMutate } = useSWRConfig();
    const userData = useUserData();

    // --- Select state and actions individually from the store ---
    const mode = useProcurementRequestStore(state => state.mode);
    const prId = useProcurementRequestStore(state => state.prId);
    const projectId = useProcurementRequestStore(state => state.projectId);

    // CEO Hold guard
    const { isCEOHold, showBlockedToast } = useCEOHoldGuard(projectId);
    const selectedWP = useProcurementRequestStore(state => state.selectedWP);
    const procList = useProcurementRequestStore(state => state.procList);
    const selectedCategories = useProcurementRequestStore(state => state.selectedCategories);
    // const newPRComment = useProcurementRequestStore(state => state.newPRComment);
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
        await globalMutate('Procurement Requests');
        await globalMutate('Procurement Orders');
        if (prId) await globalMutate(`Nirmaan Comments ${prId}`);

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
    const addCommentIfNeeded = useCallback(async (docType: string, docName: string, subject: string, commentToSave: string) => {
        // Ensure necessary data exists
        if (commentToSave && userData?.user_id && docName) {
            try {
                await createDoc("Nirmaan Comments", {
                    comment_type: "Comment",
                    reference_doctype: docType,
                    reference_name: docName,
                    comment_by: userData.user_id,
                    content: commentToSave.trim(), // Trim comment
                    subject: subject,
                });
            } catch (commentError) {
                console.error("Failed to add comment:", commentError);
                toast({ title: "Comment Failed", description: "Failed to save comment, but PR action was successful.", variant: "destructive" }); // Adjusted message
            }
        }
        // Dependencies for addCommentIfNeeded
    }, [userData?.user_id, createDoc, toast]);


    const getRefinedCategoriesList = useCallback((procList: ProcurementRequestItem[]) => {
        const categoriesList: CategorySelection[] = []
        procList.forEach(item => {
            const category = selectedCategories.find(c => c.name === item.category && c.status === item.status);
            if (category) {
                if (category?.name && categoriesList?.some(c => c.name === category.name && c.status === category.status)) {
                    return;
                }
                categoriesList.push(category!);
            }
        });
        return categoriesList;
    }, [selectedCategories]);

    // --- Submission Functions ---

    const submitNewPR = useCallback(async (finalCommentFromDialog: string) => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }

        if (!projectId || !selectedWP || procList.length === 0) {
            toast({ title: "Missing Information", description: "Project, Work Package, and items are required.", variant: "destructive" });
            return;
        }

        const endSpan = startWorkflowTransaction('new-pr', 'create', {
            project_id: projectId,
            item_count: procList.length,
            mode,
        });
        addWorkflowBreadcrumb('new-pr', 'PR submission started', { project_id: projectId });

        try {
            const backendOrderList = transformToBackendOrderList(procList);
            const payload = {
                project: projectId,
                work_package: selectedWP,
                category_list: JSON.stringify({ list: getRefinedCategoriesList(procList) }),
                order_list: backendOrderList,
            };

            const res = await createDoc("Procurement Requests", payload);
            await addCommentIfNeeded("Procurement Requests", res.name, "creating pr", finalCommentFromDialog);
            await handleSuccess(res.name, "created");

            addWorkflowBreadcrumb('new-pr', 'PR submission successful', { pr_id: res.name });
        } catch (error: any) {
            addWorkflowBreadcrumb('new-pr', 'PR submission failed', { error: error.message });
            captureWorkflowError('new-pr', error, {
                project_id: projectId,
                item_count: procList.length,
                mode,
            });

            const description = isNetworkError(error)
                ? "Network error. Please check your connection."
                : error.message || "Could not create Procurement Request.";
            toast({ title: "Submission Failed", description, variant: "destructive" });
        } finally {
            endSpan();
        }
    }, [
        projectId,
        selectedWP,
        procList,
        getRefinedCategoriesList,
        createDoc,
        addCommentIfNeeded,
        handleSuccess,
        toast,
        mode,
        isCEOHold,
        showBlockedToast,
    ]);


    const resolveOrUpdatePR = useCallback(async (finalCommentFromDialog: string) => {
        if (isCEOHold) {
            showBlockedToast();
            return;
        }

        if (!prId || procList.length === 0) {
            toast({ title: "Missing Information", description: "Cannot update without PR ID or items.", variant: "destructive" });
            return;
        }

        const operation = mode === 'edit' ? 'update' : 'resolve';
        const endSpan = startWorkflowTransaction('new-pr', operation, {
            project_id: projectId,
            pr_id: prId,
            item_count: procList.length,
            mode,
        });
        addWorkflowBreadcrumb('new-pr', `PR ${operation} started`, { pr_id: prId });

        try {
            const backendOrderList = transformToBackendOrderList(procList);
            const updateData: any = {
                category_list: JSON.stringify({ list: getRefinedCategoriesList(procList) }),
                order_list: backendOrderList,
                workflow_state: "Pending",
            };

            await updateDoc("Procurement Requests", prId, updateData);
            await addCommentIfNeeded("Procurement Requests", prId, mode === 'edit' ? "editing pr" : "resolving pr", finalCommentFromDialog);
            await handleSuccess(prId, mode === 'edit' ? "updated" : "resolved");

            addWorkflowBreadcrumb('new-pr', `PR ${operation} successful`, { pr_id: prId });
        } catch (error: any) {
            addWorkflowBreadcrumb('new-pr', `PR ${operation} failed`, { pr_id: prId, error: error.message });
            captureWorkflowError('new-pr', error, {
                project_id: projectId,
                pr_id: prId,
                item_count: procList.length,
                mode,
            });

            const description = isNetworkError(error)
                ? "Network error. Please check your connection."
                : error.message || "Could not update Procurement Request.";
            toast({ title: `${mode === 'edit' ? 'Update' : 'Resolve'} Failed`, description, variant: "destructive" });
        } finally {
            endSpan();
        }
    }, [
        prId,
        procList,
        getRefinedCategoriesList,
        mode,
        updateDoc,
        addCommentIfNeeded,
        handleSuccess,
        toast,
        projectId,
        isCEOHold,
        showBlockedToast,
    ]);


    const cancelDraftPR = useCallback(async () => {
        if (mode !== 'edit' || !prId) return;

        const endSpan = startWorkflowTransaction('new-pr', 'cancel-draft', { pr_id: prId, mode });
        addWorkflowBreadcrumb('new-pr', 'PR draft cancellation started', { pr_id: prId });

        try {
            await updateDoc("Procurement Requests", prId, {
                workflow_state: "Pending",
            });
            toast({ title: "Draft Cancelled", description: `PR ${prId} draft changes discarded.`, variant: "default" });
            resetStore();
            await globalMutate(`Procurement Requests ${prId}`);
            navigate(`/prs&milestones/procurement-requests/${prId}`);

            addWorkflowBreadcrumb('new-pr', 'PR draft cancellation successful', { pr_id: prId });
        } catch (error: any) {
            addWorkflowBreadcrumb('new-pr', 'PR draft cancellation failed', { pr_id: prId, error: error.message });
            captureWorkflowError('new-pr', error, { pr_id: prId, mode });

            const description = isNetworkError(error)
                ? "Network error. Please check your connection."
                : error.message || "Could not cancel draft.";
            toast({ title: "Cancellation Failed", description, variant: "destructive" });
        } finally {
            endSpan();
        }
    }, [mode, prId, updateDoc, navigate, resetStore, globalMutate, toast]);


    return {
        submitNewPR,
        resolveOrUpdatePR,
        cancelDraftPR,
        isSubmitting,
    };
};