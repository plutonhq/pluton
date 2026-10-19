import { useEffect, useState } from 'react';
import { collectionPage, type CollectionPageSize } from './collection';

export function useCollectionPage<T>(rows: readonly T[], resetKey: string) {
   const [position, setPosition] = useState({ page: 1, key: resetKey });
   const [pageSize, setPageSize] = useState<CollectionPageSize>(10);
   // Reset in the same render as a filter change; clamp immediately when a deletion shrinks results.
   const result = collectionPage(rows, position.key === resetKey ? position.page : 1, pageSize);
   useEffect(() => {
      if (position.key !== resetKey || position.page !== result.page) setPosition({ key: resetKey, page: result.page });
   }, [position.key, position.page, resetKey, result.page]);
   return {
      ...result,
      onPage: (page: number) => setPosition({ key: resetKey, page }),
      onSize: (size: CollectionPageSize) => {
         setPageSize(size);
         setPosition({ key: resetKey, page: 1 });
      },
   };
}
