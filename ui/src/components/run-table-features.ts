import {
  columnVisibilityFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  createSortedRowModel,
  tableFeatures,
} from '@tanstack/react-table';

// Feature declarations per the shadcn Base UI data-table guide (TanStack
// Table v9): anything not listed here is tree-shaken out of the bundle. Only
// sorting and visibility (it powers row.getVisibleCells) are enabled; pagination,
// filtering, and selection stay off because the inspector's run list has no use
// for them yet.
export const features = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    // Auto sort resolves each column's fn by sampled value type: dates use
    // datetime, mixed text/numerals use alphanumeric, plain strings use text.
    datetime: sortFn_datetime,
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
  },
});

// Pass as the first generic argument to ColumnDef/Table/Row types so each
// knows which feature APIs are available.
export type DataTableFeatures = typeof features;
