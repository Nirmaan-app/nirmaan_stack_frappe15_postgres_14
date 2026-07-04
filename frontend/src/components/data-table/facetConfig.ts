import { Column } from "@tanstack/react-table";

/**
 * Self-fetching faceted-filter config — ADR-0010 backlog #1 ("Option 2").
 *
 * A column's facet is described in two halves:
 *   - STATIC identity  -> `FacetDeclaration`, declared on the column via `meta.facet`
 *                         in the *.config.ts (co-located with the column, ADR-0010 F4).
 *   - RENDER context   -> `FacetOverride`, supplied per-column via the DataTable
 *                         `facetOverrides` prop (the volatile bits only knowable at render).
 *
 * DataTable reads the declaration off the column via `getColumnFacet()` and renders a
 * <SelfFetchingFacetFilter/>, which owns the single `useFacetValues` fetch home. Pages migrated
 * to this path drop their page-level `useFacetValues` calls and hand-built `facetFilterOptions`.
 *
 * We intentionally do NOT augment TanStack's `ColumnMeta` interface. It ships empty (permissive:
 * accepts any object literal), and this app already stores several ad-hoc keys on `meta`
 * (exportValue / exportHeaderName / excludeFromExport / isNumeric / ...) read via `meta as any`.
 * A named augmentation would switch on excess-property checks and break those ~71 literals, and a
 * generic re-declaration trips TS6205 under `noUnusedParameters`. Instead the stored shape is
 * parsed at ONE typed accessor (`getColumnFacet`, below) — the ADR-0010 F2 pattern. Declaration
 * sites keep type-safety with `satisfies FacetDeclaration` (or the `facetMeta` helper).
 */

/** STATIC facet identity — lives on the column in *.config.ts (`meta.facet`). */
export interface FacetDeclaration {
  /**
   * Backend field to aggregate on. ALWAYS explicit — never defaulted from the column id.
   * (e.g. the column id "PR Tag Child Table.tag_header" facets the field "tag_header".)
   */
  field: string;
  /** Popover / filter title. */
  title: string;
  /** Backend `require_pending_items` flag (PR / Sent-Back approve-select facets). */
  requirePendingItems?: boolean;
  /**
   * Decouple from the table's live search + column-filters (Vendor detail sub-tables):
   * the facet ignores table state and shows the unscoped value set. When false/omitted the
   * facet is cross-filtered by the current table search + other column filters.
   */
  decoupled?: boolean;
  /**
   * Rare: aggregate a DIFFERENT doctype than the table's list doctype. Defaults to the
   * `facetDoctype` DataTable prop.
   */
  doctype?: string;
}

/** RENDER-SCOPE facet context — supplied per column id via the DataTable `facetOverrides` prop. */
export interface FacetOverride {
  /** Extra Frappe filter tuples scoping the facet counts (often a render-derived useMemo). */
  additionalFilters?: any[];
  /**
   * RENDER gate (default true). When false the facet filter is not rendered at all — used for
   * route/tab-scoped facets (e.g. hide the "Project" facet when already scoped to one project,
   * or hide "Approved By" outside the Approved tab).
   *
   * NOTE: this is NOT the lazy fetch gate. Laziness (fetch-on-first-open) is internal to
   * <SelfFetchingFacetFilter/> and always on.
   */
  enabled?: boolean;
}

/** Map of column id -> render-scope override, passed to DataTable as `facetOverrides`. */
export type FacetOverrides = Record<string, FacetOverride>;

/**
 * The ONE typed reader of a column's stored facet declaration (ADR-0010 F2). DataTable calls
 * this instead of poking `columnDef.meta.facet` directly, so the `meta`-cast lives in a single place.
 */
export function getColumnFacet(column: Column<any, any>): FacetDeclaration | undefined {
  return (column.columnDef.meta as { facet?: FacetDeclaration } | undefined)?.facet;
}

/**
 * Convenience for declaration sites: `meta: facetMeta({ field, title })` gives full
 * type-checking on the declaration (the arg is typed `FacetDeclaration`). Equivalent to
 * `meta: { facet: { ... } satisfies FacetDeclaration }`. Spread other meta keys alongside:
 * `meta: { ...facetMeta({ field, title }), exportHeaderName: "..." }`.
 */
export function facetMeta(facet: FacetDeclaration): { facet: FacetDeclaration } {
  return { facet };
}
