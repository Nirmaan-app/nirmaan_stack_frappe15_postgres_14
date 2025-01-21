// import {
//   useFrappeDocTypeEventListener,
//   useFrappeGetDocList,
// } from "frappe-react-sdk";
// import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
// import {
//   ChartToolPanelsDef,
//   type ColDef,
//   type GetRowIdFunc,
//   type GetRowIdParams,
//   type ValueFormatterFunc,
//   type ValueGetterParams,
// } from "@ag-grid-community/core";
// import { ModuleRegistry } from "@ag-grid-community/core";
// import { AgGridReact } from "@ag-grid-community/react";
// import "@ag-grid-community/styles/ag-grid.css";
// import "@ag-grid-community/styles/ag-theme-material.css";
// // import { AdvancedFilterModule } from "@ag-grid-enterprise/advanced-filter";
// // import { GridChartsModule } from "@ag-grid-enterprise/charts-enterprise";
// // import { ColumnsToolPanelModule } from "@ag-grid-enterprise/column-tool-panel";
// // import { ExcelExportModule } from "@ag-grid-enterprise/excel-export";
// // import { FiltersToolPanelModule } from "@ag-grid-enterprise/filter-tool-panel";
// // import { MenuModule } from "@ag-grid-enterprise/menu";
// // import { RangeSelectionModule } from "@ag-grid-enterprise/range-selection";
// // import { RichSelectModule } from "@ag-grid-enterprise/rich-select";
// // import { RowGroupingModule } from "@ag-grid-enterprise/row-grouping";
// // import { SetFilterModule } from "@ag-grid-enterprise/set-filter";
// // import { SparklinesModule } from "@ag-grid-enterprise/sparklines";
// // import { StatusBarModule } from "@ag-grid-enterprise/status-bar";
// import React, {
//   useCallback,
//   useEffect,
//   useMemo,
//   useRef,
//   useState,
// } from "react";

// import styles from "./LivePRTracking.module.css";
// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee from "@/utils/FormatPrice";
// import { Link, useNavigate } from "react-router-dom";
// import { CsvExportModule } from "@ag-grid-community/csv-export";
// import { Button } from "@/components/ui/button";
// import { OctagonAlert } from "lucide-react";

// interface Props {
//   gridTheme?: string;
//   isDarkMode?: boolean;
// }

// ModuleRegistry.registerModules([
//   ClientSideRowModelModule,
//   CsvExportModule,
//   // AdvancedFilterModule,
//   // ColumnsToolPanelModule,
//   // ExcelExportModule,
//   // FiltersToolPanelModule,
//   // GridChartsModule,
//   // MenuModule,
//   // RangeSelectionModule,
//   // RowGroupingModule,
//   // SetFilterModule,
//   // RichSelectModule,
//   // StatusBarModule,
//   // SparklinesModule,
// ]);

// export const LivePRTrackingTable: React.FC<Props> = ({
//   gridTheme = "ag-theme-material",
//   isDarkMode = false,
// }) => {
//   const {
//     data: prList,
//     isLoading: prListLoading,
//     mutate: prListMutate,
//   } = useFrappeGetDocList("Procurement Requests", {
//     fields: ["*"],
//     orderBy: { field: "modified", order: "desc" },
//     limit: 10000,
//   });

//   useFrappeDocTypeEventListener("Procurement Requests", async (event) => {
//     await prListMutate();
//   });

//   const { data: versions } = useFrappeGetDocList("Version", {
//     fields: ["*"],
//     limit: 100000,
//     filters: [["ref_doctype", "=", "Procurement Requests"]],
//     orderBy: { field: "creation", order: "desc" },
//   });
//   //   console.log("prList", prList);

//   // console.log("versions", versions);

//   const { data: projects } = useFrappeGetDocList("Projects", {
//     fields: ["*"],
//     limit: 1000,
//   });

//   const { data: usersList } = useFrappeGetDocList("Nirmaan Users", {
//     fields: ["*"],
//     limit: 1000,
//   });

//   const getUserFullName = (id) => {
//     if (id === "Administrator") return id;
//     if (usersList) {
//       return usersList?.find((user) => user?.name === id)?.full_name;
//     }
//   };

//   const getProjectName = (id) => {
//     if (projects) {
//       return projects?.find((i) => i?.name === id)?.project_name;
//     }
//   };

//   // AG GRID CONFIGURATION STARTS FROM HERE

//   const [rowData, setRowData] = useState([]);
//   const gridRef = useRef<AgGridReact>(null);

//   useEffect(() => {
//     if (prList && versions) {
//       // Map PRs with the most recent previous state from versions
//       const dataWithPreviousState = prList.map((pr) => {
//         // Filter version docs for the current PR
//         const relevantVersions = versions.filter(
//           (ver) => ver.docname === pr.name
//         );

//         // Find the most recent version where workflow_state was changed
//         const recentVersionWithStateChange = relevantVersions.find((ver) => {
//           const changedData = JSON.parse(ver.data).changed || [];
//           return changedData.some(([field]) => field === "workflow_state");
//         });

//         // Extract previous state if a valid version is found
//         let previousState = null;
//         if (recentVersionWithStateChange) {
//           const changedData = JSON.parse(
//             recentVersionWithStateChange.data
//           ).changed;
//           const workflowStateChange = changedData.find(
//             ([field]) => field === "workflow_state"
//           );
//           if (workflowStateChange) {
//             previousState = workflowStateChange[1];
//           }
//         }

//         return {
//           ...pr,
//           previousState,
//         };
//       });
//       setRowData(dataWithPreviousState);
//     }
//   }, [prList, versions]);

//   const colDefs = useMemo<ColDef[]>(
//     () => [
//       {
//         field: "name", // PR ID
//         headerName: "PR ID",
//         // chartDataType: "category",
//         minWidth: 150,
//         editable: true,

//         // onCellClicked: ({ data }) =>
//         //   navigate(`/prs&milestones/procurement-requests/${data?.name}`),
//         // cellEditor: "agSelectCellEditor",
//         // cellEditorParams: {
//         //     values: ['Tesla', 'Ford', 'Toyota'],
//         // },
//         // cellRenderer: "agGroupCellRenderer"
//         cellRenderer: ({ value, data }) => {
//           return (
//             <Link
//               to={`/prs&milestones/procurement-requests/${data?.name}`}
//               className="text-blue-500 underline hover:text-blue-700"
//             >
//               {value.slice(3)}
//             </Link>
//           );
//         },
//       },
//       {
//         field: "project",
//         headerName: "Project",
//         // chartDataType: "category",
//         // type: "rightAligned",
//         minWidth: 150,
//         editable: true,
//         // valueGetter: ({ data }: ValueGetterParams) =>
//         //   data && parseFloat(data?.quote),
//         // valueFormatter: (params) => "₹" + params?.value?.toLocaleString(),
//         valueFormatter: (params) => getProjectName(params?.value),
//         wrapText: true,
//         autoHeight: true,
//       },
//       {
//         field: "creation",
//         headerName: "Creation",
//         editable: true,
//         // chartDataType: "time",
//         valueFormatter: (params) => formatDate(params?.value),
//         minWidth: 120,
//       },
//       {
//         // chartDataType: "category",
//         headerName: "Created By",
//         // cellDataType: "text",
//         minWidth: 130,
//         editable: true,
//         valueGetter: ({ data }: ValueGetterParams) =>
//           data && getUserFullName(data?.owner),
//         // onCellClicked: ({ data }) => navigate(`/items/${data?.item_id}`),
//         // cellClass:
//         //   "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer",
//       },
//       {
//         field: "modified",
//         headerName: "Last Modified",
//         // chartDataType: "time",
//         // type: "rightAligned",
//         minWidth: 130,
//         editable: true,
//         wrapText: true,
//         autoHeight: true,
//         valueFormatter: (params) => {
//           if (!params?.value) return "";

//           const date = new Date(params.value.replace(" ", "T")); // Ensure the date string is in ISO format
//           const localDate = date.toLocaleDateString(); // Format as localized date string
//           const localTime = date.toLocaleTimeString([], {
//             hour: "2-digit",
//             minute: "2-digit",
//           }); // Format time as HH:MM

//           return `${localDate} ${localTime}`;
//         },
//       },
//       {
//         // field: "modified_by",
//         headerName: "Last Modified By",
//         // chartDataType: "category",
//         // cellDataType: "text",
//         // type: "rightAligned",
//         minWidth: 130,
//         editable: true,
//         valueGetter: ({ data }: ValueGetterParams) =>
//           data && getUserFullName(data?.modified_by),
//       },
//       {
//         field: "previousState",
//         headerName: "Previous State",
//         cellRenderer: ({ value, data }) => {
//           return (
//             value || (
//               <div className="">
//                 <OctagonAlert />
//               </div>
//             )
//           );
//         },
//         cellClass: ({ value }) => {
//           return `${
//             value === "Approved"
//               ? "bg-green-100 text-green-800 hover:bg-green-100/80"
//               : value === "Pending"
//               ? "bg-yellow-100 text-yellow-800  hover:bg-yellow-100/80"
//               : ["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(
//                   value
//                 )
//               ? "bg-orange-100 text-orange-800  hover:bg-orange-100/80"
//               : ["Partially Approved", "Vendor Approved"].includes(value)
//               ? " bg-green-500 text-white hover:bg-green-500/80"
//               : value === "Rejected"
//               ? "bg-red-200 text-red-800  hover:bg-red-100/80"
//               : ""
//           } flex items-center justify-center`;
//         },
//         minWidth: 150,
//         editable: true,
//       },
//       {
//         field: "workflow_state",
//         headerName: "Current Status",
//         // type: "rightAligned",
//         // chartDataType: "category",
//         // cellDataType: "text",
//         // valueGetter: ({ data }: ValueGetterParams) =>
//         //   data && findVendorName(data?.vendor),
//         minWidth: 150,
//         editable: true,
//         cellClass: ({ value }) => {
//           return `${
//             value === "Approved"
//               ? " bg-green-100 text-green-800 hover:bg-green-100/80"
//               : value === "Pending"
//               ? "bg-yellow-100 text-yellow-800  hover:bg-yellow-100/80"
//               : ["RFQ Generated", "Quote Updated", "Vendor Selected"].includes(
//                   value
//                 )
//               ? "bg-orange-100 text-orange-800  hover:bg-orange-100/80"
//               : ["Partially Approved", "Vendor Approved"].includes(value)
//               ? " bg-green-500 text-white hover:bg-green-500/80"
//               : value === "Rejected"
//               ? "bg-red-200 text-red-800  hover:bg-red-100/80"
//               : ["Delayed", "Sent Back"].includes(value)
//               ? "bg-gray-100 text-gray-800  hover:bg-gray-100/80"
//               : ""
//           } flex items-center justify-center`;
//         },
//         // filter: true,
//         // floatingFilter: true
//       },
//       {
//         headerName: "Procurement Package",
//         // chartDataType: "category",
//         field: "work_package",
//         // cellDataType: "text",
//         // type: "rightAligned",
//         minWidth: 150,
//         editable: true,
//         // onCellClicked: ({ data }) =>
//         //   navigate(`${data?.procurement_order?.replaceAll("/", "&=")}`),
//         // valueGetter: ({ data }: ValueGetterParams) =>
//         //   data && data?.procurement_order?.slice(3, 12),
//         // cellClass:
//         //   "underline hover:underline-offset-2 hover:text-blue-500 cursor-pointer",
//       },
//     ],
//     [prList, usersList, projects]
//   );

//   const defaultColDef: ColDef = useMemo(
//     () => ({
//       flex: 1,
//       filter: true,
//       cellClass: "flex justify-center items-center",
//       //   enableRowGroup: true,
//       //   enableValue: true,
//     }),
//     []
//   );

//   const chartToolPanelsDef = useMemo<ChartToolPanelsDef>(() => {
//     return {
//       defaultToolPanel: "settings",
//     };
//   }, []);

//   const getRowId = useCallback<GetRowIdFunc>(
//     ({ data: { name } }: GetRowIdParams) => name,
//     []
//   );

//   const statusBar = useMemo(
//     () => ({
//       statusPanels: [
//         { statusPanel: "agTotalAndFilteredRowCountComponent" },
//         { statusPanel: "agTotalRowCountComponent" },
//         { statusPanel: "agFilteredRowCountComponent" },
//         { statusPanel: "agSelectedRowCountComponent" },
//         { statusPanel: "agAggregationComponent" },
//       ],
//     }),
//     []
//   );

//   const pagination = true;
//   const paginationPageSize = 50;
//   const paginationPageSizeSelector = [50, 100, 500];

//   const rowSelection = useMemo(() => {
//     return {
//       mode: "multiRow",
//     };
//   }, []);

//   const onBtnExport = useCallback(() => {
//     gridRef.current!.api.exportDataAsCsv();
//   }, []);

//   const themeClass = `${gridTheme}${isDarkMode ? "-dark" : ""}`;

//   return (
//     <div className="flex-1 space-y-4">
//       <Button onClick={onBtnExport}>Download CSV export file</Button>
//       <div className={styles.wrapper}>
//         <div className={styles.container}>
//           <div className={`${themeClass} ${styles.grid}`}>
//             <AgGridReact
//               ref={gridRef}
//               getRowId={getRowId}
//               rowData={rowData}
//               columnDefs={colDefs}
//               defaultColDef={defaultColDef}
//               // cellSelection = {true}
//               // enableCharts={true}
//               chartToolPanelsDef={chartToolPanelsDef}
//               rowSelection={rowSelection}
//               rowGroupPanelShow={"always"}
//               suppressAggFuncInHeader
//               groupDefaultExpanded={-1}
//               // statusBar={statusBar}
//               pagination={pagination}
//               paginationPageSize={paginationPageSize}
//               paginationPageSizeSelector={paginationPageSizeSelector}
//               onCellValueChanged={(e) => console.log("New Cell Value: ", e)} // when editing a column value, we can track that using this event
//               // masterDetail
//             />
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

export const LivePRTrackingTable = () => {
  return (
    <div>Hlleo</div>
  )
}