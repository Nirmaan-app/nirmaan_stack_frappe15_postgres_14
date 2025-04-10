// src/components/validation/ValidationIndicator.tsx
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { AlertTriangle, Info } from "lucide-react";
import { ValidationError } from "./ValidationTypes";

interface ValidationIndicatorProps {
  error?: ValidationError;
}

export const ValidationIndicator = ({ error }: ValidationIndicatorProps) => (
  <HoverCard>
    <HoverCardTrigger>
      <AlertTriangle className="h-4 w-4 text-yellow-500 inline-block ml-2" 
        aria-label="Validation warning" role="alert" />
    </HoverCardTrigger>
    <HoverCardContent className="bg-background text-foreground border border-border shadow-lg">
      <div className="space-y-2">
        <div className="font-medium">
          <Info className="h-4 w-4 text-primary inline-block" />
          <h4 className="text-sm inline ml-1">{error?.message}</h4>
        </div>
        <p className="text-sm">{error?.resolution}</p>
        {error?.link && (
          <a href={error?.link} className="text-primary text-sm hover:underline">
            Resolve now →
          </a>
        )}
      </div>
    </HoverCardContent>
  </HoverCard>
);