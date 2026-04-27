import React from "react";
import { Filter, Lock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  PROJECT_STATUS_OPTIONS,
  ProjectStatus,
  DEFAULT_PROJECT_STATUS_FILTER,
} from "./projectStatus";

interface ProjectStatusFilterProps {
  /** Whether the user can edit the selection. Non-editable users see a locked badge. */
  editable: boolean;
  value: ProjectStatus[];
  onChange: (next: ProjectStatus[]) => void;
  /** What to show in the locked state (defaults to the default filter). */
  lockedFallback?: ProjectStatus[];
  className?: string;
}

export const ProjectStatusFilter: React.FC<ProjectStatusFilterProps> = ({
  editable,
  value,
  onChange,
  lockedFallback = DEFAULT_PROJECT_STATUS_FILTER,
  className,
}) => {
  const toggle = (status: ProjectStatus) => {
    onChange(
      value.includes(status)
        ? value.filter((s) => s !== status)
        : [...value, status]
    );
  };

  if (!editable) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 h-11 px-2.5 rounded-md border border-gray-300 bg-gray-50 text-gray-700 w-fit whitespace-nowrap",
          className
        )}
        title="Only Admin can change the status filter"
      >
        <Lock className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
          Status:
        </span>
        {lockedFallback.map((status) => (
          <Badge
            key={status}
            variant="secondary"
            className="bg-yellow-50 text-yellow-700 hover:bg-yellow-50 border border-yellow-200 text-[11px] font-medium"
          >
            {status}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "flex items-center gap-2 h-11 border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap",
            className
          )}
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Status</span>
          {value.length > 0 && (
            <Badge
              variant="secondary"
              className="h-5 min-w-[20px] px-1.5 bg-primary text-white text-xs"
            >
              {value.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Filter by status..." className="h-9" />
          <CommandList>
            <CommandEmpty>No status found.</CommandEmpty>
            <CommandGroup>
              {PROJECT_STATUS_OPTIONS.map((status) => {
                const isSelected = value.includes(status);
                return (
                  <CommandItem
                    key={status}
                    onSelect={() => toggle(status)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-sm border transition-colors",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-primary/20 opacity-50"
                        )}
                      >
                        <Check
                          className={cn(
                            "h-3 w-3",
                            isSelected ? "text-white" : "opacity-0"
                          )}
                        />
                      </div>
                      <span>{status}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {value.length > 0 && (
            <div className="p-2 border-t text-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => onChange([])}
              >
                Clear filters
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};
