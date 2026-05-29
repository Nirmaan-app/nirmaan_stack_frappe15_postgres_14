import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";

interface BoqProjectTabProps {
  projectId: string;
}

const BoqProjectTab = ({ projectId }: BoqProjectTabProps) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      <FileSpreadsheet className="h-12 w-12 text-muted-foreground opacity-40" />
      <div>
        <p className="text-sm font-medium text-foreground">No BoQs uploaded yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Upload an Excel Bill of Quantities to get started.
        </p>
      </div>
      <Button
        className="mt-2"
        onClick={() => navigate(`/upload-boq?project=${projectId}`)}
      >
        <FileSpreadsheet className="mr-2 h-4 w-4" />
        Upload BoQ
      </Button>
    </div>
  );
};

export default BoqProjectTab;
