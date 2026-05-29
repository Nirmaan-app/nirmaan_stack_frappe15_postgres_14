import { useNavigate } from "react-router-dom";
import { ArrowRight, Briefcase, FileSearch } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Pre-wizard "Won or Tendering" choice screen.
 *
 * Rendered at `/projects/new-project`. Choosing:
 *   - "Won"       -> the existing 6-step wizard (unchanged) at `.../won`
 *   - "Tendering" -> the minimal stub form at `.../tendering`
 *
 * Authorization (Admin / PMO / Administrator) is enforced by the route guard
 * that wraps this screen and its children (see routesConfig).
 */
export const NewProjectChoice = () => {
  const navigate = useNavigate();

  const choices = [
    {
      key: "won",
      title: "Won Project",
      description:
        "An awarded job. Fill the full project details — address, timeline, work packages and team — through the standard 6-step wizard.",
      icon: Briefcase,
      accent: "text-indigo-600",
      ring: "hover:border-indigo-400 hover:shadow-indigo-100",
      onClick: () => navigate("/projects/new-project/won"),
    },
    {
      key: "tendering",
      title: "Tendering Project",
      description:
        "A prospect you are still bidding for. Capture only Name, City, State and (optionally) Customer. No address, timeline or work packages needed yet.",
      icon: FileSearch,
      accent: "text-slate-600",
      ring: "hover:border-slate-400 hover:shadow-slate-100",
      onClick: () => navigate("/projects/new-project/tendering"),
    },
  ];

  return (
    <div className="flex-1 space-y-6 max-w-3xl mx-auto py-4">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">New Project</h2>
        <p className="text-muted-foreground">
          Is this an awarded project, or one you are still tendering for?
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {choices.map((choice) => {
          const Icon = choice.icon;
          return (
            <Card
              key={choice.key}
              role="button"
              tabIndex={0}
              onClick={choice.onClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choice.onClick();
                }
              }}
              className={cn(
                "cursor-pointer transition-all border-2 border-transparent",
                "hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/40",
                choice.ring
              )}
            >
              <CardContent className="p-6 flex flex-col gap-3 h-full">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className={cn("h-5 w-5", choice.accent)} />
                  </div>
                  <h3 className="text-lg font-semibold">{choice.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground flex-1">
                  {choice.description}
                </p>
                <div
                  className={cn(
                    "flex items-center gap-1 text-sm font-medium",
                    choice.accent
                  )}
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default NewProjectChoice;
