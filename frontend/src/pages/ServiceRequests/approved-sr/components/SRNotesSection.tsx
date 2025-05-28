import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // Using Input for single-line note for simplicity
import { Textarea } from "@/components/ui/textarea"; // Or Textarea for multi-line
import { Trash2, Edit3, Check, X } from "lucide-react";
import { NoteItem, useSREditTerms } from '../hooks/useSREditTerms'; // Assuming notes are part of SREditTerms
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ServiceRequestsExtended } from '../hooks/useApprovedSRData';

interface SRNotesSectionProps {
    srDoc: ServiceRequestsExtended | undefined; // To get initial notes and for saving
    notesData: NoteItem[]; // From useSREditTerms hook's formState.notes
    currentNoteInput: string;
    editingNoteId: string | null;
    isSavingTerms: boolean; // From useSREditTerms hook
    onNoteInputChange: (value: string) => void;
    onAddOrUpdateNote: () => void;
    onEditNote: (id: string) => void;
    onDeleteNote: (id: string) => void;
    // If notes save separately from other terms:
    // onSaveNotes: () => Promise<boolean>;
}

export const SRNotesSection: React.FC<SRNotesSectionProps> = ({
    srDoc,
    notesData,
    currentNoteInput,
    editingNoteId,
    isSavingTerms,
    onNoteInputChange,
    onAddOrUpdateNote,
    onEditNote,
    onDeleteNote,
}) => {
    // If notes are saved as part of a larger "Save Terms" action, this component is simpler.
    // If notes can be saved independently, it would need its own save handler.
    // For this example, assuming it's part of the SREditTerms save flow.

    return (
        <Card className="shadow-sm">
            <CardHeader>
                <CardTitle className="text-lg text-muted-foreground">Internal Notes</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="mb-4 space-y-2">
                    <Textarea
                        placeholder="Type a new note..."
                        value={currentNoteInput}
                        onChange={(e) => onNoteInputChange(e.target.value)}
                        rows={2}
                        className="text-sm"
                    />
                    <Button onClick={onAddOrUpdateNote} size="sm" disabled={!currentNoteInput.trim() || isSavingTerms}>
                        {editingNoteId ? "Update Note" : "Add Note"}
                    </Button>
                    {editingNoteId && (
                        <Button onClick={() => { onNoteInputChange(""); onEditNote(""); }} variant="ghost" size="sm"> {/* Pass empty string to clear input */}
                            Cancel Edit
                        </Button>
                    )}
                </div>

                {notesData.length > 0 ? (
                    <ul className="space-y-2">
                        {notesData.map((note) => (
                            <li key={note.id} className="text-sm p-2 border rounded-md bg-muted/30 flex justify-between items-start">
                                <p className="whitespace-pre-wrap flex-grow mr-2">{note.note}</p>
                                <div className="flex-shrink-0 space-x-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEditNote(note.id)} disabled={isSavingTerms}>
                                        <Edit3 className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDeleteNote(note.id)} disabled={isSavingTerms}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">No notes added yet.</p>
                )}
            </CardContent>
        </Card>
    );
};