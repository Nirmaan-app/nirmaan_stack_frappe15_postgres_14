// HOD Tracker detail: one project's handover, on its own page (`/hod-tracker/:projectId`).
//
// The same shape as the Design Tracker, which is a list at `/design-tracker` and a detail at
// `/design-tracker/:id` rather than a redirect into the Project page.
//
// This is a THIN WRAPPER on purpose. `HandoverDocumentsTab` already takes a `projectId` and fetches
// everything it needs itself (`useProjectHod`), so the page mounts the very same component the project
// page mounts -- the tracker and the project tab can never drift, because there is only one screen.
// `projectName` is not passed: the tab resolves its own label from its payload
// (`payload.project.project_name`), and the prop is only its fallback.

import { ArrowLeft } from "lucide-react";
import React from "react";
import { Link, useParams } from "react-router-dom";

import { HandoverDocumentsTab } from "./HandoverDocumentsTab";

export const HodTrackerDetail: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">No project in the address.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 p-4 md:p-6">
      {/* The project page supplies its own breadcrumb; standing alone, this page needs a way back. */}
      <Link
        to="/hod-tracker"
        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        HOD Tracker
      </Link>

      <HandoverDocumentsTab projectId={projectId} />
    </div>
  );
};

export default HodTrackerDetail;
