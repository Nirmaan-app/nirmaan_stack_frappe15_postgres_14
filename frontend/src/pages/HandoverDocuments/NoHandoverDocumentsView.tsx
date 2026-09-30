// The Handover Documents tab before any system is added — same look as the Commission Report's
// "Not Found" card. "Create Handover Documents" opens the system picker (AddSystemDialog).

import {
  BookOpenText,
  CirclePlus,
  FolderArchive,
  Info,
  Lock,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const WHAT_YOU_CAN_DO = [
  "Add the systems this project hands over (Electrical, HVAC, …)",
  "Track the 16 handover documents of each system",
  "Fill the escalation chart, lists and certificates; add the O&M pictures",
  "Download each document, the checklist or the whole binder as PDF",
];

export const NoHandoverDocumentsView: React.FC<{
  projectName: string;
  canEdit: boolean;
  /** No HOD System exists yet on this site. */
  libraryEmpty: boolean;
  canEditLibrary: boolean;
  onCreate: () => void;
  onShowGuide: () => void;
}> = ({
  projectName,
  canEdit,
  libraryEmpty,
  canEditLibrary,
  onCreate,
  onShowGuide,
}) => (
  <div className="flex min-h-[400px] flex-col items-center justify-center p-8">
    <Card className="w-full max-w-2xl border-2 border-dashed">
      <CardContent className="flex flex-col items-center justify-center space-y-6 px-6 py-12">
        <div className="rounded-full bg-red-50 p-6">
          <FolderArchive className="h-12 w-12 text-red-700" />
        </div>

        <div className="space-y-3 text-center">
          <h3 className="text-2xl font-bold text-gray-900">
            Handover Documents Not Found
          </h3>
          <p className="max-w-md text-base text-gray-600">
            Track and manage the handover documents for{" "}
            <span className="font-semibold text-primary">{projectName}</span> by
            adding the systems it hands over
          </p>
        </div>

        <div className="w-full max-w-md space-y-2 rounded-lg bg-gray-50 p-4">
          <p className="mb-2 text-sm font-semibold text-gray-700">
            What you can do:
          </p>
          <ul className="space-y-2 text-sm text-gray-600">
            {WHAT_YOU_CAN_DO.map((line) => (
              <li key={line} className="flex items-start">
                <span className="mr-2 text-red-700">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onShowGuide}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline"
          >
            <Info className="h-3.5 w-3.5" /> How it works
          </button>
        </div>

        {libraryEmpty ? (
          <div className="flex w-full max-w-md items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="space-y-2 text-sm text-amber-800">
              <p>No HOD system is set up yet, so there is nothing to add.</p>
              {canEditLibrary && (
                <Link
                  to="/packages-settings?tab=handover-documents"
                  className="inline-flex items-center gap-1 font-semibold underline"
                >
                  <BookOpenText className="h-3.5 w-3.5" /> Set up the library
                </Link>
              )}
            </div>
          </div>
        ) : canEdit ? (
          <Button
            onClick={onCreate}
            size="lg"
            className="h-auto px-8 py-6 text-base"
          >
            <CirclePlus className="mr-2 h-5 w-5" />
            Create Handover Documents
          </Button>
        ) : (
          <div className="flex w-full max-w-md items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              Only an{" "}
              <span className="font-semibold">
                Admin, PMO, Project Lead or Project Manager
              </span>{" "}
              can create the handover documents. Please contact one of them to
              set them up for this project.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  </div>
);
