import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Lock, RefreshCw } from "lucide-react";

export interface EditingLockIndicatorProps {
  lockedByName: string;
  lockedAt: string; // ISO timestamp
  onRefresh: () => void;
  onEditAnyway: () => void;
  isRefreshing?: boolean;
}

export const EditingLockIndicator = ({
  lockedByName,
  lockedAt,
  onRefresh,
  onEditAnyway,
  isRefreshing = false,
}: EditingLockIndicatorProps) => {
  const relativeTime = formatDistanceToNow(new Date(lockedAt), {
    addSuffix: true,
  });

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-md">
      <Lock className="h-4 w-4 text-amber-600 flex-shrink-0" />
      <span className="text-sm text-amber-800">
        <strong>{lockedByName}</strong> started editing {relativeTime}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
        </Button>
        <Button variant="outline" size="sm" onClick={onEditAnyway}>
          Edit Anyway
        </Button>
      </div>
    </div>
  );
};
