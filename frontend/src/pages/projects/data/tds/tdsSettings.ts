// The one place a `Project TDS Setting` record becomes the six stakeholder cards the export dialog
// shows. The field names are NOT guessable — three of them are misspelled in the doctype
// (`mananger_logo`, `data_tjxu` for the consultant, `mep_contractorlogo`) — so this mapping is kept
// in one place and imported by everything that opens the dialog (the TDS Repository tab and the
// Handover Documents tab).

import type { ProjectTDSSetting } from "@/types/NirmaanStack/ProjectTDSSetting";
import type { TDSRepositoryData } from "../../TDSRepository/components/SetupTDSRepositoryDialog";

export const toTdsRepositoryData = (
  setting: ProjectTDSSetting,
): TDSRepositoryData => ({
  client: {
    name: setting.client_name,
    logo: setting.client_logo as any,
    enabled: setting.enable_client,
  },
  projectManager: {
    name: setting.manager_name,
    logo: setting.mananger_logo as any,
    enabled: setting.enable_manager,
  },
  architect: {
    name: setting.architect_name,
    logo: setting.architect_logo as any,
    enabled: setting.enable_architect,
  },
  consultant: {
    name: setting.data_tjxu,
    logo: setting.consultant_logo as any,
    enabled: setting.enable_consultant,
  },
  gcContractor: {
    name: setting.gc_contractor_name,
    logo: setting.gc_contractor_logo as any,
    enabled: setting.enable_gc_contractor,
  },
  mepContractor: {
    name: setting.mep_contractor_name,
    logo: setting.mep_contractorlogo as any,
    enabled: setting.enable_mep_contractor,
  },
});

/** What `export_tds_report` wants: the same six roles with the logo as a stored URL (a freshly picked
 *  `File` has no URL yet, so it is dropped — the server reads logos off the saved record). */
export const toExportSettingsPayload = (data: TDSRepositoryData) => {
  const role = (r: TDSRepositoryData["client"]) => ({
    name: r.name,
    logo: typeof r.logo === "string" ? r.logo : null,
    enabled: r.enabled,
  });
  return {
    client: role(data.client),
    projectManager: role(data.projectManager),
    architect: role(data.architect),
    consultant: role(data.consultant),
    gcContractor: role(data.gcContractor),
    mepContractor: role(data.mepContractor),
  };
};
