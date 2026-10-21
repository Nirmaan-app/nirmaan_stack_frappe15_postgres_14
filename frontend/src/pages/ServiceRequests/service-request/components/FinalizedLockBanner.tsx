import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lock } from "lucide-react";
import { FINALIZED_LOCK_MESSAGE } from "../../config/finalizedLock";

/** Names what a Finalized Work Order locks and how to unlock it; the server refuses with the same text (#1539). */
export const FinalizedLockBanner: React.FC = () => (
  <Alert className="border-green-200 bg-green-50 text-green-900 [&>svg]:text-green-700">
    <Lock className="h-4 w-4" />
    <AlertTitle>Finalized</AlertTitle>
    <AlertDescription>{FINALIZED_LOCK_MESSAGE}</AlertDescription>
  </Alert>
);
