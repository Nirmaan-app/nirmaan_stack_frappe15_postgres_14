import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import {
  MapPin,
  Calendar,
  ExternalLink,
  Trash2,
  Building2,
} from "lucide-react";

interface ProjectCardProps {
  projectId: string;
  projectName: string | undefined;
  address: string;
  dateAdded: string;
  onDelete?: () => void;
  showDeleteButton?: boolean;
  isDeleting?: boolean;
}

export function ProjectCard({
  projectId,
  projectName,
  address,
  dateAdded,
  onDelete,
  showDeleteButton = true,
  isDeleting = false,
}: ProjectCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Card
      className={cn(
        "group relative flex flex-col overflow-hidden transition-all duration-300",
        "hover:shadow-lg hover:shadow-primary/5",
        "hover:border-primary/20",
        isDeleting && "opacity-50 pointer-events-none"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Gradient accent on hover */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/80 to-primary/60",
          "transform origin-left transition-transform duration-300",
          isHovered ? "scale-x-100" : "scale-x-0"
        )}
      />

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0",
              "bg-primary/10 text-primary",
              "transition-all duration-300",
              isHovered && "bg-primary text-primary-foreground scale-105"
            )}>
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base font-semibold truncate">
                {projectName || projectId}
              </CardTitle>
              <CardDescription className="text-xs font-mono truncate">
                {projectId}
              </CardDescription>
            </div>
          </div>

          {showDeleteButton && onDelete && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 text-muted-foreground",
                      "opacity-0 group-hover:opacity-100",
                      "hover:text-destructive hover:bg-destructive/10",
                      "transition-all duration-200"
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Remove project access</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-grow space-y-3 pt-0">
        {/* Location */}
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground truncate">{address}</span>
        </div>

        {/* Date Added */}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground">
            Added{" "}
            <span className="text-foreground font-medium">
              {formatDate(dateAdded)}
            </span>
          </span>
        </div>
      </CardContent>

      {/* Hover action footer */}
      <div
        className={cn(
          "px-4 py-3 bg-muted/30 border-t",
          "transform transition-all duration-300",
          isHovered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        )}
      >
        <Link
          to={`/projects/${projectId}`}
          className={cn(
            "flex items-center justify-center gap-2 w-full",
            "text-sm font-medium text-primary",
            "hover:underline"
          )}
        >
          View Project
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </Card>
  );
}

// Compact version for smaller displays
export function ProjectCardCompact({
  projectId,
  projectName,
  address,
  onDelete,
  showDeleteButton = true,
}: Omit<ProjectCardProps, "dateAdded" | "isDeleting">) {
  return (
    <div className="group flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary/20 hover:shadow-sm transition-all duration-200">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
        <Building2 className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          {projectName || projectId}
        </p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span className="truncate">{address}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Link to={`/projects/${projectId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
        {showDeleteButton && onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
