/**
 * Handover Documents (HOD) — the project tab.
 *
 * A standalone feature: it WRITES only its own `Project HOD Document` rows. The Commission Report,
 * TDS, Snag List and Design Tracker are read (six of the 16 documents come from them), never changed.
 *
 * One tab per system the team ADDS ("+ Add system" creates that system's 16 rows); each tab is the
 * system's checklist. Titles, kinds and numbering come from the server's index, not from here.
 */

import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import { BookOpenText, Info, Loader2, Plus } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { getFrappeError } from "@/utils/frappeErrors";

import { AddSystemDialog } from "./AddSystemDialog";
import {
  HOD_ROWS_CHANGED_EVENT,
  useHodMutations,
  useProjectHod,
} from "./hodApi";
import { HodGuideDialog } from "./HodGuideDialog";
import { NoHandoverDocumentsView } from "./NoHandoverDocumentsView";
import { SystemChecklist } from "./SystemChecklist";
import { useHodBinder } from "./useHodBinder";

export interface HandoverDocumentsTabProps {
  projectId: string;
  projectName?: string;
}

export const HandoverDocumentsTab: React.FC<HandoverDocumentsTabProps> = ({
  projectId,
  projectName,
}) => {
  const { payload, isLoading, error, mutate } = useProjectHod(projectId);
  const { addSystems, removeSystem, updateRow } = useHodMutations();
  const { build, job, progress } = useHodBinder();
  const [showGuide, setShowGuide] = React.useState(false);
  const { socket } = React.useContext(FrappeContext) as FrappeConfig;
  const [active, setActive] = React.useState<string>("");
  const [adding, setAdding] = React.useState(false);

  // Another user's change on this project refreshes the tab.
  React.useEffect(() => {
    if (!socket) return;
    const onChanged = (d: { project?: string }) => {
      if (d?.project === projectId) mutate();
    };
    socket.on(HOD_ROWS_CHANGED_EVENT, onChanged);
    return () => {
      socket.off(HOD_ROWS_CHANGED_EVENT, onChanged);
    };
  }, [socket, projectId, mutate]);

  const added = payload?.added ?? [];
  // The chosen tab, or the first system while nothing (or a since-removed system) is chosen.
  const current = added.includes(active) ? active : (added[0] ?? "");

  const systemsByName = React.useMemo(
    () => new Map((payload?.systems ?? []).map((s) => [s.name, s])),
    [payload?.systems],
  );

  const handleUpdateRow = React.useCallback(
    async (name: string, patch: Parameters<typeof updateRow>[1]) => {
      await updateRow(name, patch);
      await mutate();
    },
    [updateRow, mutate],
  );

  const handleAdd = async (systems: string[]) => {
    try {
      await addSystems(projectId, systems);
      await mutate();
      setActive(systems[0]);
      toast({
        title: "Handover documents created",
        description: `${systems.join(", ")} added — 16 documents each.`,
        variant: "success",
      });
    } catch (e: any) {
      toast({
        title: "Could not add the systems",
        description: getFrappeError(e),
        variant: "destructive",
      });
      throw e;
    }
  };

  const handleRemove = async (system: string, force: boolean) => {
    try {
      await removeSystem(projectId, system, force);
      await mutate();
      toast({
        title: "Removed",
        description: `${system} is no longer handed over on this project.`,
        variant: "success",
      });
    } catch (e: any) {
      toast({
        title: "Could not remove",
        description: getFrappeError(e),
        variant: "destructive",
      });
      throw e;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading handover
        documents…
      </div>
    );
  }
  if (error || !payload) {
    return (
      <p className="py-10 text-center text-sm text-red-600">
        Could not load the handover documents.
      </p>
    );
  }

  const canEdit = payload.can_edit;
  const projectLabel = payload.project.project_name || projectName || projectId;

  return (
    <div className="space-y-4">
      {added.length > 0 && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Handover Documents
            </h2>
            <p className="text-sm text-gray-500">
              The documents handed over to the client, system by system.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-gray-600"
              title="How Handover Documents work"
              onClick={() => setShowGuide(true)}
            >
              <Info className="mr-1 h-4 w-4" /> Details
            </Button>
            {payload.can_edit_library && !payload.library_empty && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 text-gray-600"
                asChild
              >
                {/* Packages Settings → Handover Documents: the library, in the app. */}
                <Link to="/packages-settings?tab=handover-documents">
                  <BookOpenText className="mr-1 h-4 w-4" /> Edit library
                </Link>
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => setAdding(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> Add system
              </Button>
            )}
          </div>
        </div>
      )}

      {added.length === 0 ? (
        <NoHandoverDocumentsView
          projectName={projectLabel}
          canEdit={canEdit}
          libraryEmpty={payload.library_empty}
          canEditLibrary={payload.can_edit_library}
          onCreate={() => setAdding(true)}
          onShowGuide={() => setShowGuide(true)}
        />
      ) : (
        <Tabs value={current} onValueChange={setActive}>
          <TabsList className="h-auto flex-wrap justify-start">
            {added.map((name) => {
              const c = payload.counts[name];
              return (
                <TabsTrigger key={name} value={name} className="gap-2">
                  {name}
                  {c && (
                    <span className="rounded-full bg-gray-200 px-1.5 text-[10px] font-semibold text-gray-700">
                      {c.completed}/{c.needed}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {added.map((name) => {
            const system = systemsByName.get(name);
            if (!system) return null;
            return (
              <TabsContent key={name} value={name}>
                <SystemChecklist
                  project={payload.project}
                  system={system}
                  rows={payload.rows[name] ?? []}
                  counts={payload.counts[name]}
                  documents={payload.documents}
                  canEdit={canEdit}
                  updateRow={handleUpdateRow}
                  onRemoveSystem={(force) => handleRemove(name, force)}
                  job={job}
                  progress={job?.hodSystem === name ? progress : null}
                  onBuild={(document, title) =>
                    build(projectId, name, title, document)
                  }
                />
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      <HodGuideDialog open={showGuide} onOpenChange={setShowGuide} />

      <AddSystemDialog
        open={adding}
        onOpenChange={setAdding}
        projectName={projectLabel}
        firstTime={added.length === 0}
        systems={payload.systems}
        onAdd={handleAdd}
      />
    </div>
  );
};
