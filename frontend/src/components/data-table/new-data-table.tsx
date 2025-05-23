import * as React from "react";
import {
  flexRender, ColumnDef, Row as TanRow, Table as TanTable
} from "@tanstack/react-table";
import {
  Table, TableHeader, TableBody, TableRow,
  TableHead, TableCell
} from "@/components/ui/table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox }  from "@/components/ui/checkbox";
import { Input }     from "@/components/ui/input";
import { Button }    from "@/components/ui/button";
import { FileUp }    from "lucide-react";
import { toast }     from "@/components/ui/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { DataTablePagination   } from "./data-table-pagination";
import { DataTableViewOptions  } from "./data-table-view-options";
import { DataTableFacetedFilter} from "./data-table-faceted-filter";
import { DataTableDateFilter   } from "./data-table-date-filter";
import { TableBodySkeleton     } from "@/components/ui/skeleton";
import { exportToCsv           } from "@/utils/exportToCsv";

/* ---------- public props ------------------------------------------------ */
export interface SearchFieldOption {
    value: string;
    label: string;
    placeholder?: string; // Optional placeholder specific to this field
    default?: boolean; // Default search field
    is_json?: boolean; // Is JSON field
}


export interface DataTableProps<T> {
  table                  : TanTable<T>;
  columns                : ColumnDef<T, any>[];
  isLoading              : boolean;
  error?                 : Error|null;
  totalCount             : number;

  /* search */
  searchFieldOptions     : SearchFieldOption[];
  selectedSearchField    : string;
  onSelectedSearchFieldChange: (v:string)=>void;
  searchTerm             : string;
  onSearchTermChange     : (v:string)=>void;

  /* filters */
  facetFilterOptions?    : Record<string,{title:string;options:{label:string,value:string}[]}>;
  dateFilterColumns?     : string[];

  /* export */
  showExportButton?      : boolean;
  onExport?              : (()=>void)|"default";
  exportFileName?        : string;

  toolbarActions?        : React.ReactNode;
  className?             : string;

  /* row selection / indicator */
  showRowSelection?      : boolean;
  isNewRow?              : (row:TanRow<T>)=>boolean;
  newRowIndicatorComponent?: React.ReactNode;

  estimatedRowHeight?    : number;
}

/* ---------- component --------------------------------------------------- */
export function DataTable<T>({
  table, columns,
  isLoading, error, totalCount,
  searchFieldOptions, selectedSearchField, onSelectedSearchFieldChange,
  searchTerm, onSearchTermChange,
  facetFilterOptions = {}, dateFilterColumns = [],
  showExportButton = false, onExport, exportFileName = "data",
  toolbarActions, className,
  showRowSelection = false,
  isNewRow,
  newRowIndicatorComponent = <div className="h-2 w-2 rounded-full bg-red-500" />,
  estimatedRowHeight = 45,
}: DataTableProps<T>) {

  /* ───────── helpers ───────── */
  const leafCols = React.useMemo(()=>table.getAllLeafColumns(),[table]);
  const colWidths = React.useMemo(
      ()=>leafCols.map(c=>c.getSize() ?? 150),[leafCols]);

  const shouldRenderSelectionColumn = showRowSelection && table.options.enableRowSelection;
  const shouldRenderIndicatorColumn = !!isNewRow;

  /* ───────── virtualizer ───────── */
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  const paddingTop    = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length
        ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length-1].end
        : 0;

  // --- Default Export Handler ---
    const handleDefaultExport = React.useCallback(() => {
        if (isLoading || rows.length === 0) {
            toast({ title: "Export", description: "No data available or still loading.", variant: "default" });
            return;
        }

        let dataToExport: T[];
        const selectedRows = table.getSelectedRowModel().rows;

        if (showRowSelection) {
            dataToExport = selectedRows.map(row => row.original);
        } else {
            // Export all currently rendered rows in the table (respects client-side pagination if any, or all fetched if server-paginated)
            dataToExport = rows.map(row => row.original);
        }

        if (!dataToExport || dataToExport.length === 0) {
            toast({ title: "Export", description: `No data to export.`, variant: "default" });
            return;
        }

        try {
            // Use userDefinedColumns for export to respect what the user configured for display
            const exportableColumns = columns.filter(col =>
                (col.header || (col as any).accessorKey) && !(col.meta as any)?.excludeFromExport
            );
            exportToCsv(exportFileName, dataToExport, exportableColumns); // Use your generic utility
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success"});
            if (showRowSelection) {
                table.resetRowSelection(true); // Clear selection after export
            }
        } catch (error) {
            console.error("Default export failed:", error);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive"});
        }
    }, [isLoading, rows, columns, exportFileName, toast]);


  // --- Determine actual onExport handler ---
    const effectiveExport = React.useMemo(() => {
        if (onExport === 'default') return handleDefaultExport;
        return onExport; // Could be undefined or a custom function
    }, [onExport, handleDefaultExport]);

  /* ───────── column sticky offset helper ───────── */
  const stickyOffset = React.useCallback((dataIndex:number)=>{
    let off = 0;
    if (shouldRenderIndicatorColumn) off+=20;
    if (shouldRenderSelectionColumn) off+=40;
    for(let i=0;i<dataIndex;i++) off += colWidths[i];
    return off;
  },[shouldRenderIndicatorColumn,shouldRenderSelectionColumn,colWidths]);

  /* ───────── UI ───────── */
  return (
  <div className={`space-y-4 ${className??""}`}>

    {/* ───── Toolbar ───── */}
    <Toolbar
      {...{
        searchFieldOptions,selectedSearchField,onSelectedSearchFieldChange,
        searchTerm,onSearchTermChange,
        showExportButton,effectiveExport,toolbarActions,isLoading,table,
        showRowSelection
      }}
    />

    {/* error */}
    {error && (
      <div className="p-4 text-center text-red-600 bg-red-100 border border-red-300 rounded-md">
        Error fetching data: {error.message}
      </div>
    )}

    {/* ───── Table container ───── */}
    <div ref={parentRef}
         className="rounded-md border overflow-x-auto max-h-[70vh] overflow-y-auto">

      <Table className="min-w-full table-fixed">

        {/* ---- colgroup guarantees identical widths ---- */}
        <colgroup>
          {shouldRenderIndicatorColumn && <col style={{width:20}} />}
          {shouldRenderSelectionColumn && <col style={{width:40}} />}
          {colWidths.map((w,i)=><col key={i} style={{width:w}} />)}
        </colgroup>

        {/* ---- Header ---- */}
        <TableHeader className="sticky top-0 z-10 bg-red-50 shadow-sm">
          {table.getHeaderGroups().map(hg=>(
            <TableRow key={hg.id}>
              {shouldRenderIndicatorColumn && (
                <TableHead className="w-[20px] sticky left-0 bg-red-50 z-20 px-1" />
              )}
              {shouldRenderSelectionColumn && (
                <TableHead className={`w-[40px] sticky bg-red-50 z-20 ${shouldRenderIndicatorColumn?'left-[20px]':'left-0'}`}>
                  <Checkbox
                    checked={
                      table.getIsAllPageRowsSelected()
                        ? true
                        : table.getIsSomePageRowsSelected()
                          ? "indeterminate" : false}
                    onCheckedChange={v=>table.toggleAllPageRowsSelected(!!v)}
                  />
                </TableHead>
              )}

              {hg.headers.map((h,i)=>{
                 if (shouldRenderSelectionColumn && h.id==="select") return null;
                 const first = i===0;
                 const left  = first ? stickyOffset(0) : undefined;
                const columnInstance = h.column;
                const canShowFacetedFilter = facetFilterOptions?.[columnInstance.id];
                const canShowDateFilter = dateFilterColumns.includes(columnInstance.id);
                 return (
                   <TableHead key={h.id}
                      className={first?"sticky bg-red-50 z-20":undefined}
                      style={{left, width:h.getSize()}}>
                     {h.isPlaceholder ? null :
                     (
                        <div className="flex items-center gap-1">
                            {canShowFacetedFilter && ( <DataTableFacetedFilter column={columnInstance!} title={facetFilterOptions[h.column.id]!.title} options={facetFilterOptions[h.column.id]!.options} /> )}
                            {canShowDateFilter && ( <DataTableDateFilter column={columnInstance!} title={h.column.columnDef.header as string || h.column.id} /> )}
                            {flexRender(h.column.columnDef.header,h.getContext())}
                        </div>
                     )}
                   </TableHead>
                 );
              })}
            </TableRow>
          ))}
        </TableHeader>

        {/* ---- Body with padding rows ---- */}
        <TableBody>
          {isLoading ? (
            <TableBodySkeleton rows={10} colSpan={leafCols.length+ (shouldRenderIndicatorColumn?1:0)+(shouldRenderSelectionColumn?1:0)} />
          ) : (
            <>
              {paddingTop>0 && (
                <TableRow><TableCell style={{height:paddingTop,border:0}} /></TableRow>
              )}

              {virtualRows.map(vRow=>{
                const row = rows[vRow.index] as TanRow<T>;
                return (
                  <TableRow key={row.id} data-state={row.getIsSelected()&&"selected"}>
                    {shouldRenderIndicatorColumn && (
                      <TableCell className="sticky left-0 z-[5] w-[20px] px-1">
                        {isNewRow && isNewRow(row)?newRowIndicatorComponent:null}
                      </TableCell>
                    )}

                    {shouldRenderSelectionColumn && (
                      <TableCell className={`sticky z-[5] w-[40px] px-2 ${shouldRenderIndicatorColumn?'left-[20px]':'left-0'}`}>
                        <Checkbox
                          checked={row.getIsSelected()}
                          onCheckedChange={v=>row.toggleSelected(!!v)}
                        />
                      </TableCell>
                    )}

                    {row.getVisibleCells().map((cell,idx)=>{
                      if (shouldRenderSelectionColumn && cell.column.id==="select") return null;
                      const first = idx===0;
                      const left  = first?stickyOffset(0):undefined;
                      return (
                        <TableCell key={cell.id}
                                   className={first?"sticky z-[5] bg-white":undefined}
                                   style={{left}}>
                          {flexRender(cell.column.columnDef.cell,cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}

              {paddingBottom>0 && (
                <TableRow><TableCell style={{height:paddingBottom,border:0}} /></TableRow>
              )}
            </>

          )}
        </TableBody>
      </Table>
    </div>

    {/* pagination */}
    <DataTablePagination table={table} totalCount={totalCount} isLoading={isLoading}/>
  </div>
  );
}

/* ---------- tiny sub-toolbar component (same look) -------------------- */
function Toolbar(props:{
  searchFieldOptions:SearchFieldOption[];
  selectedSearchField:string; onSelectedSearchFieldChange:(v:string)=>void;
  searchTerm:string; onSearchTermChange:(v:string)=>void;
  showExportButton:boolean; effectiveExport?:()=>void;
  toolbarActions?:React.ReactNode; isLoading:boolean;
  table: TanTable<any>; showRowSelection:boolean;
}){
  const searchInputId = React.useId();
  const cfg = props.searchFieldOptions.find(o=>o.value===props.selectedSearchField)
           ?? props.searchFieldOptions[0];
  const ph = cfg?.placeholder || `Search by ${cfg?.label}`;

  return (
  <div className="flex flex-wrap items-center justify-between gap-4 py-4">
    <div className="flex items-center gap-2 flex-grow sm:flex-grow-0 sm:w-auto">
      {props.searchFieldOptions.length>0 && (
        <Select value={props.selectedSearchField}
                onValueChange={props.onSelectedSearchFieldChange}>
          <SelectTrigger className="min-w-[150px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {props.searchFieldOptions.map(o=>
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Input 
        aria-label={ph}
        id={searchInputId} 
        className="h-9 w-full sm:w-[250px] lg:w-[300px]"
        placeholder={ph} value={props.searchTerm}
        onChange={e=>props.onSearchTermChange(e.target.value)} />
    </div>

    <div className="flex items-center gap-2">
      {props.toolbarActions}
      {props.showExportButton && props.effectiveExport && (
        <Button size="sm" variant="outline"
                disabled={props.isLoading ||
                  (props.showRowSelection &&
                   props.table.getSelectedRowModel().rows.length===0)}
                onClick={props.effectiveExport}>
          <FileUp className="h-4 w-4 mr-1"/> Export
        </Button>
      )}
      <DataTableViewOptions table={props.table}/>
    </div>
  </div>);
}