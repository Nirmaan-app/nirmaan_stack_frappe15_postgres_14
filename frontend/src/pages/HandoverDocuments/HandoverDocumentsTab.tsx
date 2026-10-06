/**
 * Handover Documents (HOD) — the project tab.
 *
 * A standalone feature: it WRITES only its own `Project HOD Document` rows. The Commission Report,
 * TDS, Snag List and Design Tracker are read (six of the 16 documents come from them), never changed.
 *
 * One tab per system the team ADDS ("+ Add package" creates that system's 16 rows); each tab is the
 * system's checklist. Titles, kinds and numbering come from the server's index, not from here.
 *
 * ON SCREEN a system is called a PACKAGE (owner 2026-10-06, UI wording only): the code, the API and the
 * `HOD System` doctype keep "system".
 */

import { FrappeConfig, FrappeContext } from "frappe-react-sdk";
import {
  BookOpenText,
  Images,
  Info,
  Loader2,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";

import { AddSystemDialog } from "./AddSystemDialog";
import {
  HOD_ROWS_CHANGED_EVENT,
  useHodMutations,
  useHodSignedCopy,
  useProjectHod,
} from "./hodApi";
import { HeaderLogosDialog } from "./HeaderLogosDialog";
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
  const { uploadSignedCopy } = useHodSignedCopy();
  const [showGuide, setShowGuide] = React.useState(false);
  const [showLogos, setShowLogos] = React.useState(false);
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
        title: "Could not add the packages",
        description: getFrappeError(e),
        variant: "destructive",
      });
      throw e;
    }
  };

  /** A package's signed copy: stored (or replaced) on the project's HOD Setting (owner 2026-10-06). */
  const handleSignedCopy = async (system: string, file: File) => {
    try {
      await uploadSignedCopy(projectId, system, file);
      await mutate();
      toast({
        title: "Signed copy saved",
        description: `${file.name} is stored for ${system}.`,
        variant: "success",
      });
    } catch (e: any) {
      toast({
        title: "Could not save the signed copy",
        description: getFrappeError(e),
        variant: "destructive",
      });
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
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-lg font-semibold text-gray-900">
                Handover Documents
              </h2>
              {/* The guide is help, not an action -- it reads as one next to the heading and
                  leaves the action row to the things that change something (owner 2026-09-28). */}
              <button
                type="button"
                title="How Handover Documents work"
                aria-label="How Handover Documents work"
                className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                onClick={() => setShowGuide(true)}
              >
                <Info className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-gray-500">
              The documents handed over to the client, package by package.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 text-gray-600"
                title="Which logos head this project's handover documents"
                onClick={() => setShowLogos(true)}
              >
                <Images className="mr-1 h-4 w-4" /> Header logos
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => setAdding(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> Add package
              </Button>
            )}
            {payload.can_edit_library && !payload.library_empty && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 p-0 text-gray-500"
                    title="More"
                    aria-label="More handover options"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild className="gap-2 text-sm">
                    {/* Packages Settings -> Handover Documents: the library, in the app. */}
                    <Link to="/packages-settings?tab=handover-documents">
                      <BookOpenText className="h-4 w-4 text-gray-500" />
                      Edit library
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
              const done = !!c && c.needed > 0 && c.completed >= c.needed;
              return (
                <TabsTrigger key={name} value={name} className="gap-2">
                  {name}
                  {c && (
                    <span
                      title={`${c.completed} of ${c.needed} Done`}
                      className={cn(
                        "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                        done
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-700",
                      )}
                    >
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
                  signedCopy={payload.signed_copies?.[name] ?? null}
                  onUploadSignedCopy={(file) => handleSignedCopy(name, file)}
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

      <HeaderLogosDialog
        open={showLogos}
        onOpenChange={setShowLogos}
        projectId={projectId}
        canEdit={canEdit}
      />

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
