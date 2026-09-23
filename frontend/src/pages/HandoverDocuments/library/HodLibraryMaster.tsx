// Packages Settings → Handover Documents: the HOD library, in the app instead of Desk.
// One tab per system (the same tabs a project's Handover Documents shows), and under each of them all
// 16 handover documents in their printed order — what the library carries for each, whether a new
// project starts with it switched on, and an Edit that opens that document's own dialog.
// Projects read this live, so an edit here shows on the next PDF of every project handing the system over.

import {
  AlertTriangle,
  BookOpenText,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { TailSpin } from "react-loader-spinner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { getFrappeError } from "@/utils/frappeErrors";

import type { HodDocumentMeta } from "../types";
import { ContentDialog } from "./ContentDialog";
import { DocumentSetupDialog } from "./DocumentSetupDialog";
import {
  documentSetup,
  HOD_CONTENT_DOCTYPE,
  HOD_SYSTEM_DOCTYPE,
  HodLibraryBlockAdmin,
  HodSystemAdmin,
  LibraryDocument,
  lines,
  useHodLibrary,
  useHodLibraryMutations,
} from "./hodLibraryApi";
import { SystemDialog } from "./SystemDialog";

/** The same three kinds the project checklist shows, so one document reads the same on both screens. */
const KIND_LABEL: Record<string, { label: string; className: string }> = {
  form: { label: "Form", className: "bg-blue-50 text-blue-700" },
  template: { label: "Library", className: "bg-purple-50 text-purple-700" },
  app: { label: "From Nirmaan", className: "bg-teal-50 text-teal-700" },
};

type Deleting =
  | { kind: "system"; system: HodSystemAdmin }
  | { kind: "block"; block: HodLibraryBlockAdmin };

export const HodLibraryMaster: React.FC = () => {
  const { library, error, isLoading, mutate } = useHodLibrary();
  const { deleteDoc, updateDoc, saving } = useHodLibraryMutations();

  const [selected, setSelected] = React.useState<string>("");
  const [systemDialog, setSystemDialog] = React.useState<
    { system?: HodSystemAdmin } | null
  >(null);
  const [docDialog, setDocDialog] = React.useState<HodDocumentMeta | null>(null);
  const [contentDialog, setContentDialog] = React.useState<{
    document: LibraryDocument;
    block?: HodLibraryBlockAdmin;
  } | null>(null);
  /** The document row to come back to when a block editor or a delete finishes. */
  const [returnTo, setReturnTo] = React.useState<HodDocumentMeta | null>(null);
  const [deleting, setDeleting] = React.useState<Deleting | null>(null);
  const [toggling, setToggling] = React.useState<string>("");

  const systems = library?.systems ?? [];
  const current =
    systems.find((s) => s.name === selected) ?? systems[0] ?? undefined;
  const canEdit = !!library?.can_edit;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <TailSpin width={40} height={40} color="#dc2626" />
      </div>
    );
  }
  if (error || !library) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center text-red-600">
        Could not load the handover library: {getFrappeError(error)}
      </div>
    );
  }

  /** Leave the document dialog for a block editor or a delete, and come back to it afterwards. */
  const leaveDocDialog = (meta: HodDocumentMeta, go: () => void) => {
    setReturnTo(meta);
    setDocDialog(null);
    go();
  };
  const backToDocDialog = () => {
    if (returnTo) {
      setDocDialog(returnTo);
      setReturnTo(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      if (deleting.kind === "system") {
        await deleteDoc(HOD_SYSTEM_DOCTYPE, deleting.system.name);
      } else {
        await deleteDoc(HOD_CONTENT_DOCTYPE, deleting.block.name);
      }
      await mutate();
      toast({ title: "Deleted", variant: "success" });
      setDeleting(null);
      backToDocDialog();
    } catch (e) {
      toast({
        title: "Could not delete",
        description: getFrappeError(e),
        variant: "destructive",
      });
    }
  };

  /** Switch one document on or off for new projects of this system (HOD System.default_disabled_documents). */
  const toggleDefault = async (
    system: HodSystemAdmin,
    key: string,
    needed: boolean,
  ) => {
    const next = needed
      ? system.default_disabled.filter((k) => k !== key)
      : [...system.default_disabled, key];
    setToggling(key);
    try {
      // The index order keeps the stored lines reading the same way every time.
      await updateDoc(HOD_SYSTEM_DOCTYPE, system.name, {
        default_disabled_documents: library.documents
          .filter((d) => next.includes(d.key))
          .map((d) => d.key)
          .join("\n"),
      });
      await mutate();
    } catch (e) {
      toast({
        title: "Could not change it",
        description: getFrappeError(e),
        variant: "destructive",
      });
    } finally {
      setToggling("");
    }
  };

  return (
    <div className="flex-1 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
            <BookOpenText className="h-5 w-5 text-gray-500" /> Handover
            Documents library
          </h2>
          <p className="text-sm text-gray-500">
            One tab per system. Under it are the 16 handover documents as they
            print — set up the ones the library carries, and choose which a new
            project starts with switched off.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setSystemDialog({})}>
            <Plus className="mr-1 h-4 w-4" /> New system
          </Button>
        )}
      </div>

      {systems.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-12 text-center">
          <p className="text-sm text-gray-600">
            No handover system yet. Add one for each system your projects hand
            over (Electrical, HVAC, CCTV…).
          </p>
          {canEdit && (
            <Button
              size="sm"
              className="mt-3"
              onClick={() => setSystemDialog({})}
            >
              <Plus className="mr-1 h-4 w-4" /> New system
            </Button>
          )}
        </div>
      ) : (
        <Tabs value={current?.name ?? ""} onValueChange={setSelected}>
          <TabsList className="h-auto flex-wrap justify-start">
            {systems.map((s) => (
              <TabsTrigger key={s.name} value={s.name} className="gap-2">
                {s.system_name}
                {!s.is_active && (
                  <Badge variant="outline" className="text-[10px]">
                    Inactive
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {systems.map((s) => (
            <TabsContent key={s.name} value={s.name} className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-white p-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-800">
                    {s.system_name}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Prints as {s.display_name} · {s.work_package}
                    {s.projects > 0 &&
                      ` · used by ${s.projects} project${s.projects === 1 ? "" : "s"}`}
                  </p>
                  {lines(s.source_keywords).length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      Keywords: {lines(s.source_keywords).join(", ")}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSystemDialog({ system: s })}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit system
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-gray-500 hover:text-red-600"
                      onClick={() => setDeleting({ kind: "system", system: s })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border bg-white">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                      <th className="w-14 px-2 py-2 text-center">S.No</th>
                      <th className="px-2 py-2">Document</th>
                      <th className="w-56 px-2 py-2">In the library</th>
                      <th className="w-32 px-2 py-2 text-center">
                        New projects
                      </th>
                      <th className="w-20 px-2 py-2 text-center">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {library.documents.map((d) => {
                      const setup = documentSetup(d, s);
                      const off = s.default_disabled.includes(d.key);
                      const kind = KIND_LABEL[d.kind];
                      return (
                        <tr
                          key={d.key}
                          className={cn("border-t", off && "bg-gray-50/80")}
                        >
                          <td className="px-2 py-2 text-center text-gray-500">
                            {d.no}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "font-medium",
                                  off ? "text-gray-400" : "text-gray-900",
                                )}
                              >
                                {d.title}
                              </span>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  off
                                    ? "bg-gray-100 text-gray-400"
                                    : kind.className,
                                )}
                              >
                                {kind.label}
                              </span>
                            </div>
                          </td>
                          <td
                            className={cn(
                              "px-2 py-2",
                              setup.setup === "none"
                                ? "text-gray-400"
                                : "text-gray-600",
                            )}
                          >
                            {setup.holds}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <Switch
                              checked={!off}
                              disabled={!canEdit || toggling === d.key}
                              title={
                                off
                                  ? "A new project starts with this switched off"
                                  : "A new project starts with this switched on"
                              }
                              onCheckedChange={(on) =>
                                toggleDefault(s, d.key, on)
                              }
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title={`Open ${d.title}`}
                              onClick={() => setDocDialog(d)}
                            >
                              <Settings2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {systemDialog && (
        <SystemDialog
          open
          onOpenChange={(o) => !o && setSystemDialog(null)}
          system={systemDialog.system}
          workPackages={library.work_packages}
          documents={library.documents}
          onSaved={mutate}
        />
      )}

      {docDialog && current && (
        <DocumentSetupDialog
          open
          onOpenChange={(o) => !o && setDocDialog(null)}
          system={current}
          meta={docDialog}
          canEdit={canEdit}
          onEditBlock={(block) =>
            leaveDocDialog(docDialog, () =>
              setContentDialog({
                document: docDialog.library as LibraryDocument,
                block,
              }),
            )
          }
          onDeleteBlock={(block) =>
            leaveDocDialog(docDialog, () =>
              setDeleting({ kind: "block", block }),
            )
          }
          onSaved={mutate}
        />
      )}

      {contentDialog && current && (
        <ContentDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setContentDialog(null);
              backToDocDialog();
            }
          }}
          hodSystem={current.name}
          block={contentDialog.block}
          document={contentDialog.document}
          libraryDocuments={library.library_documents}
          onSaved={mutate}
        />
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o && !saving) {
            setDeleting(null);
            backToDocDialog();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting?.kind === "system"
                ? `Delete ${deleting.system.system_name}?`
                : `Delete ${deleting?.block.title}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind === "system" ? (
                deleting.system.projects > 0 ? (
                  <span className="flex items-start gap-2 text-amber-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {deleting.system.projects} project
                    {deleting.system.projects === 1 ? "" : "s"} already hand
                    this system over, so it cannot be deleted. Remove it from
                    those projects first, or switch it to inactive so it is not
                    offered again.
                  </span>
                ) : (
                  "Its text blocks are deleted with it. No project uses it."
                )
              ) : (
                "Projects handing this system over stop printing this text on their next download. What they filled against it is not shown again."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            {!(deleting?.kind === "system" && deleting.system.projects > 0) && (
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700"
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  remove();
                }}
              >
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
