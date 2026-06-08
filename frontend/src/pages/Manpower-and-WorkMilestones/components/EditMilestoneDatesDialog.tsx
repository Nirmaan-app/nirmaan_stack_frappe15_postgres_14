import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { formatDate } from '@/utils/FormatDate';

const toInputDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface EditMilestoneDatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestoneName: string;
  rowName: string | null;
  startDate: Date | null;
  endDate: Date | null;
  changedByUser: boolean;
  projectStartDate: Date | null;
  projectEndDate: Date | null;
  onSave: (rowName: string, startISO: string, endISO: string) => Promise<void>;
  onReset: (rowName: string) => Promise<void>;
}

export const EditMilestoneDatesDialog: React.FC<EditMilestoneDatesDialogProps> = ({
  open,
  onOpenChange,
  milestoneName,
  rowName,
  startDate,
  endDate,
  changedByUser,
  projectStartDate,
  projectEndDate,
  onSave,
  onReset,
}) => {
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (open) {
      setEditStart(startDate ? toInputDate(startDate) : '');
      setEditEnd(endDate ? toInputDate(endDate) : '');
    }
  }, [open, startDate, endDate]);

  const handleSave = useCallback(async () => {
    if (!rowName) {
      toast({
        title: 'Cannot save',
        description: 'Schedule is still loading. Try again in a moment.',
        variant: 'destructive',
      });
      return;
    }
    if (!editStart || !editEnd) {
      toast({ title: 'Both Start and End dates are required', variant: 'destructive' });
      return;
    }
    const start = new Date(editStart);
    const end = new Date(editEnd);
    if (end < start) {
      toast({ title: 'End date must be on or after start date', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await onSave(rowName, editStart, editEnd);
      toast({
        title: 'Milestone dates updated',
        description: `${formatDate(start)} → ${formatDate(end)}`,
        variant: 'success',
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'Failed to update milestone dates',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [rowName, editStart, editEnd, onSave, onOpenChange]);

  const handleReset = useCallback(async () => {
    if (!rowName) return;
    setResetting(true);
    try {
      await onReset(rowName);
      toast({
        title: 'Reset to derived dates',
        description: 'Milestone dates revert to the formula-derived defaults.',
        variant: 'success',
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'Failed to reset',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setResetting(false);
    }
  }, [rowName, onReset, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Milestone Dates</DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-medium text-gray-700">{milestoneName}</span>
            <br />
            Override the formula-derived Start and End dates for this milestone. The change is
            stamped with your user identity in the schedule's history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Start Date</label>
            <Input
              type="date"
              value={editStart}
              min={projectStartDate ? toInputDate(projectStartDate) : undefined}
              max={editEnd || (projectEndDate ? toInputDate(projectEndDate) : undefined)}
              onChange={(e) => setEditStart(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">End Date</label>
            <Input
              type="date"
              value={editEnd}
              min={editStart || (projectStartDate ? toInputDate(projectStartDate) : undefined)}
              max={projectEndDate ? toInputDate(projectEndDate) : undefined}
              onChange={(e) => setEditEnd(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {changedByUser && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={saving || resetting || !rowName}
              className="mr-auto"
            >
              {resetting ? 'Resetting…' : 'Reset to derived'}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || resetting}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || resetting || !editStart || !editEnd || !rowName}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditMilestoneDatesDialog;
