import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { Link } from "react-router-dom";

interface LinkedPOsColumnProps {
  task: CriticalPOTask;
  projectId: string;
  mutate: () => Promise<any>;
  canDelete?: boolean; // Controls whether delete/unlink button is shown
}

export const LinkedPOsColumn: React.FC<LinkedPOsColumnProps> = ({ task, projectId, mutate, canDelete = false }) => {
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [poToUnlink, setPoToUnlink] = useState<string | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const { updateDoc } = useFrappeUpdateDoc();

  // Parse linked POs
  const linkedPOs = useMemo(() => {
    try {
      const associated = task.associated_pos;
      if (typeof associated === "string") {
        const parsed = JSON.parse(associated);
        return parsed?.pos || [];
      } else if (associated && typeof associated === "object") {
        return associated.pos || [];
      }
      return [];
    } catch {
      return [];
    }
  }, [task.associated_pos]);

  // Extract PO ID (2nd part after /)
  const extractPOId = (fullName: string) => {
    const parts = fullName.split("/");
    return parts.length > 1 ? parts[1] : fullName;
  };

  // Encode PO name for URL (replace / with &=)
  const encodePOName = (poName: string) => {
    return poName.replaceAll("/", "&=");
  };

  const handleUnlinkClick = (poName: string) => {
    setPoToUnlink(poName);
    setUnlinkDialogOpen(true);
  };

  const confirmUnlink = async () => {
    if (!poToUnlink) return;

    setIsUnlinking(true);

    try {
      // Remove the PO from the list
      const updatedPOs = linkedPOs.filter((po: string) => po !== poToUnlink);

      await updateDoc("Critical PO Tasks", task.name, {
        associated_pos: JSON.stringify({ pos: updatedPOs }),
      });

      toast({
        title: "Success",
        description: "PO unlinked successfully.",
        variant: "success",
      });

      await mutate();
      setUnlinkDialogOpen(false);
      setPoToUnlink(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unlink PO.",
        variant: "destructive",
      });
    } finally {
      setIsUnlinking(false);
    }
  };

  if (linkedPOs.length === 0) {
    return <span className="text-gray-400 text-sm">-</span>;
  }

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {linkedPOs.map((poName: string) => (
          <Badge
            key={poName}
            variant="secondary"
            className={`flex items-center gap-1 max-w-[140px] ${canDelete ? "pr-1 group hover:bg-red-100" : "pr-2"} transition-colors`}
          >
            <Link
              to={`/projects/${projectId}/po/${encodePOName(poName)}`}
              className="text-blue-600 hover:underline truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {extractPOId(poName)}
            </Link>
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 hover:bg-transparent group-hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnlinkClick(poName);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </Badge>
        ))}
      </div>

      {/* Unlink Confirmation Dialog - Only rendered when canDelete is true */}
      {canDelete && (
        <AlertDialog open={unlinkDialogOpen} onOpenChange={setUnlinkDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unlink PO?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to unlink <strong>{poToUnlink && extractPOId(poToUnlink)}</strong> from this task?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isUnlinking}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmUnlink}
                disabled={isUnlinking}
                className="bg-red-600 hover:bg-red-700"
              >
                {isUnlinking ? "Unlinking..." : "Unlink"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
};
