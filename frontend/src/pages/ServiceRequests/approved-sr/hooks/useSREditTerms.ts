import { useState, useEffect, useCallback } from 'react';
import { useFrappeUpdateDoc } from 'frappe-react-sdk';
import { toast } from '@/components/ui/use-toast';
import { v4 as uuidv4 } from 'uuid';
import { ServiceRequestsExtended } from './useApprovedSRData';

export interface NoteItem {
    id: string;
    note: string;
}

export interface SREditTermsForm {
    notes: NoteItem[];
    gstEnabled: boolean;
    projectGst?: string; // Assuming project_gst on SR is the one to update
}

export const useSREditTerms = (
    srDoc: ServiceRequestsExtended | undefined,
    mutateSR: () => Promise<any> // Callback to refresh main SR data
) => {
    const [formState, setFormState] = useState<SREditTermsForm>({
        notes: [],
        gstEnabled: false,
        projectGst: ""
    });
    const [currentNoteInput, setCurrentNoteInput] = useState<string>("");
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

    const { updateDoc, loading: isSaving } = useFrappeUpdateDoc();

    useEffect(() => {
        if (srDoc) {
            setFormState({
                notes: srDoc.parsed_notes || [], // Use pre-parsed notes from useApprovedSRData
                gstEnabled: srDoc.gst === "true",
                projectGst: srDoc.project_gst || "",
            });
        }
    }, [srDoc]);

    const handleNoteInputChange = (value: string) => setCurrentNoteInput(value);

    const addOrUpdateNote = useCallback(() => {
        if (!currentNoteInput.trim()) return;
        setFormState(prev => {
            if (editingNoteId) {
                return {
                    ...prev,
                    notes: prev.notes.map(n => n.id === editingNoteId ? { ...n, note: currentNoteInput.trim() } : n)
                };
            } else {
                return {
                    ...prev,
                    notes: [...prev.notes, { id: uuidv4(), note: currentNoteInput.trim() }]
                };
            }
        });
        setCurrentNoteInput("");
        setEditingNoteId(null);
    }, [currentNoteInput, editingNoteId]);

    const editNote = useCallback((id: string) => {
        const noteToEdit = formState.notes.find(n => n.id === id);
        if (noteToEdit) {
            setCurrentNoteInput(noteToEdit.note);
            setEditingNoteId(id);
        }
    }, [formState.notes]);

    const deleteNote = useCallback((id: string) => {
        setFormState(prev => ({ ...prev, notes: prev.notes.filter(n => n.id !== id) }));
        if (editingNoteId === id) { // If deleting the note being edited
            setCurrentNoteInput("");
            setEditingNoteId(null);
        }
    }, [editingNoteId]);

    const handleGstToggle = (checked: boolean) => {
        setFormState(prev => ({ ...prev, gstEnabled: checked }));
    };
    
    const handleProjectGstChange = (gstValue?: string) => {
        setFormState(prev => ({ ...prev, projectGst: gstValue || ""}));
    };

    const saveTerms = async () => {
        if (!srDoc) return;
        try {
            await updateDoc("Service Requests", srDoc.name, {
                notes: JSON.stringify({ list: formState.notes }),
                gst: formState.gstEnabled ? "true" : "false",
                project_gst: formState.projectGst,
            });
            await mutateSR();
            toast({ title: "Success", description: "Terms and notes updated." });
            return true; // Indicate success
        } catch (error: any) {
            toast({ title: "Error", description: `Failed to save: ${error.message}`, variant: "destructive" });
            return false;
        }
    };

    return {
        formState,
        currentNoteInput,
        editingNoteId,
        isSaving,
        setFormState, // If direct manipulation from dialog is needed
        handleNoteInputChange,
        addOrUpdateNote,
        editNote,
        deleteNote,
        handleGstToggle,
        handleProjectGstChange,
        saveTerms,
    };
};