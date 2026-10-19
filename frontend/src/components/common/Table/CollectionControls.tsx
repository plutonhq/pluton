import type { ReactNode } from 'react';
import { COLLECTION_PAGE_SIZES, type CollectionPageSize } from './collection';
import classes from './CollectionControls.module.scss';
import paginationClasses from '../Pagination/Pagination.module.scss';

export function CollectionToolbar({
   label,
   search,
   onSearch,
   sort,
   onSort,
   options,
   children,
}: {
   label: string;
   search: string;
   onSearch: (value: string) => void;
   sort: string;
   onSort: (value: string) => void;
   options: readonly { value: string; label: string }[];
   children?: ReactNode;
}) {
   return (
      <div className={classes.toolbar} role="search" aria-label={`${label} filters`}>
         <label>
            Search {label}
            <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} />
         </label>
         {children}
         <label>
            Sort {label}
            <select value={sort} onChange={(event) => onSort(event.target.value)}>
               {options.map((option) => (
                  <option key={option.value} value={option.value}>
                     {option.label}
                  </option>
               ))}
            </select>
         </label>
      </div>
   );
}

export function CollectionPagination({
   label,
   page,
   pageSize,
   total,
   totalPages,
   start,
   end,
   onPage,
   onSize,
   busy = false,
}: {
   label: string;
   page: number;
   pageSize: CollectionPageSize;
   total: number;
   totalPages: number;
   start: number;
   end: number;
   onPage: (page: number) => void;
   onSize: (size: CollectionPageSize) => void;
   busy?: boolean;
}) {
   return (
      <nav className={paginationClasses.pagination} aria-label={`${label} pagination`} aria-busy={busy}>
         <span role="status">{busy ? `Loading ${label}…` : `Showing ${start}–${end} of ${total} ${label}`}</span>
         <div className={paginationClasses.controls}>
            <label>
               {label} per page
               <select disabled={busy} value={pageSize} onChange={(event) => onSize(Number(event.target.value) as CollectionPageSize)}>
                  {COLLECTION_PAGE_SIZES.map((size) => (
                     <option key={size} value={size}>
                        {size}
                     </option>
                  ))}
               </select>
            </label>
            <button type="button" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>
               Previous
            </button>
            <span>
               Page {page} of {totalPages}
            </span>
            <button type="button" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>
               Next
            </button>
         </div>
      </nav>
   );
}
