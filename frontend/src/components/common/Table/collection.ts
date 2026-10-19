export const COLLECTION_PAGE_SIZES = [10, 25, 50] as const;
export type CollectionPageSize = (typeof COLLECTION_PAGE_SIZES)[number];

/** Configuration lists are already returned by their existing APIs; never fetch extra pages here. */
export function collectionPage<T>(rows: readonly T[], requestedPage: number, pageSize: CollectionPageSize) {
   const total = rows.length;
   const totalPages = Math.max(1, Math.ceil(total / pageSize));
   const page = Math.min(totalPages, Math.max(1, requestedPage));
   const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
   return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total,
      totalPages,
      start,
      end: Math.min(page * pageSize, total),
   };
}

export function stableCollectionSort<T extends { id: string }>(rows: readonly T[], compare: (a: T, b: T) => number): T[] {
   return [...rows].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
}
