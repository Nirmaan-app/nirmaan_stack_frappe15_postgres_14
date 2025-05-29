import React from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from '@/components/ui/textarea'; // For multi-line notes input
import { useSREditTerms, NoteItem } from '../hooks/useSREditTerms'; // Import hook and NoteItem
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { Projects } from '@/types/NirmaanStack/Projects'; // Needed for project GST options
import { TailSpin } from 'react-loader-spinner';
import { Check, CirclePlus, Edit3, Save, Trash2, X } from 'lucide-react';


interface SREditTermsDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    srDoc: ServiceRequests | undefined; // Initial SR data
    projectDoc: Projects | undefined; // For GST options
    mutateSR: () => Promise<any>; // To refresh SR data after save
}

export const SREditTermsDialog: React.FC<SREditTermsDialogProps> = ({
    isOpen,
    onOpenChange,
    srDoc,
    projectDoc,
    mutateSR,
}) => {
    const {
        formState,
        currentNoteInput,
        editingNoteId,
        isSaving,
        handleNoteInputChange,
        addOrUpdateNote,
        editNote,
        deleteNote,
        handleGstToggle,
        handleProjectGstChange,
        saveTerms,
    } = useSREditTerms(srDoc, mutateSR);

    const projectGstOptions = React.useMemo(() => {
        if (!projectDoc?.project_gst_number) return [];
        try {
            const parsed = typeof projectDoc.project_gst_number === 'string'
                ? JSON.parse(projectDoc.project_gst_number)
                : projectDoc.project_gst_number;
            return Array.isArray(parsed?.list) ? parsed.list : [];
        } catch (e) {
            return [];
        }
    }, [projectDoc]);

    const handleSaveAndClose = async () => {
        const success = await saveTerms();
        if (success) {
            onOpenChange(false); // Close dialog on successful save
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Edit SR Terms & Notes</DialogTitle>
                    <DialogDescription>Modify GST settings and internal notes for SR: {srDoc?.name}</DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-6 overflow-y-auto flex-grow pr-2">
                    {/* Project GST Selection */}
                    <div className="space-y-1.5">
                        <Label htmlFor="projectGstSelect" className="font-medium">Project GST (Billing From)</Label>
                        <Select
                            value={formState.projectGst}
                            onValueChange={handleProjectGstChange}
                            disabled={isSaving}
                        >
                            <SelectTrigger id="projectGstSelect">
                                <SelectValue placeholder="Select Project GST for Nirmaan" />
                            </SelectTrigger>
                            <SelectContent>
                                {projectGstOptions.map((opt: {gst: string, location: string}) => (
                                    <SelectItem key={opt.gst} value={opt.gst}>
                                        {opt.location} ({opt.gst})
                                    </SelectItem>
                                ))}
                                {projectGstOptions.length === 0 && <SelectItem value="" disabled>No GST configured for project</SelectItem>}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* GST Applicable Switch */}
                    <div className="flex items-center justify-between space-y-1.5">
                        <Label htmlFor="gstApplicableSwitch" className="font-medium">GST Applicable on SR Total?</Label>
                        <Switch
                            id="gstApplicableSwitch"
                            checked={formState.gstEnabled}
                            onCheckedChange={handleGstToggle}
                            disabled={isSaving}
                        />
                    </div>

                    {/* Notes Section */}
                    <div className="space-y-1.5">
                        <Label className="font-medium">Internal Notes</Label>
                        <div className="space-y-2">
                            <Textarea
                                placeholder="Type a new note..."
                                value={currentNoteInput}
                                onChange={(e) => handleNoteInputChange(e.target.value)}
                                rows={3}
                                className="text-sm"
                                disabled={isSaving}
                            />
                            <div className="flex gap-2">
                                <Button onClick={addOrUpdateNote} size="sm" disabled={!currentNoteInput.trim() || isSaving}>
                                    {editingNoteId ? <><Edit3 className="mr-1 h-4 w-4"/>Update</> : <><CirclePlus className="mr-1 h-4 w-4"/>Add</>}
                                </Button>
                                {editingNoteId && (
                                    <Button onClick={() => { handleNoteInputChange(""); editNote("");}} variant="ghost" size="sm" disabled={isSaving}>
                                       <X className="mr-1 h-4 w-4"/> Cancel Edit
                                    </Button>
                                )}
                            </div>
                        </div>
                        {formState.notes.length > 0 && (
                            <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto border p-2 rounded-md">
                                {formState.notes.map((note) => (
                                    <div key={note.id} className="text-xs p-1.5 border-b last:border-b-0 bg-muted/20 rounded flex justify-between items-center group">
                                        <p className="whitespace-pre-wrap flex-grow mr-1">{note.note}</p>
                                        <div className="flex-shrink-0 space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => editNote(note.id)} disabled={isSaving}>
                                                <Edit3 className="h-3 w-3" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteNote(note.id)} disabled={isSaving}>
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="mt-auto pt-4 border-t">
                    <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSaveAndClose} disabled={isSaving}>
                        {isSaving ? <TailSpin color="#fff" height={20} width={20} /> : <><Save className="mr-2 h-4 w-4"/>Save Changes</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};